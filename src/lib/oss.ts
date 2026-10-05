import OSS from 'ali-oss';

/**
 * 阿里云 OSS 封装（Phase 0 基建）。
 *
 * Phase 1 的文本资产内容存 Postgres（阿里云 RDS）；Phase 2 起图片/视频等二进制资产使用本模块：
 * 上传到 OSS，数据库仅存 storage_key，读取时用签名 URL 直连 OSS。
 */

let publicClient: OSS | undefined;
let serverClient: OSS | undefined;

function createOssClient(internal: boolean): OSS {
  const { OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET } = process.env;
  if (!OSS_REGION || !OSS_BUCKET || !OSS_ACCESS_KEY_ID || !OSS_ACCESS_KEY_SECRET) {
    throw new Error(
      'Aliyun OSS is not configured. Set OSS_REGION / OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET in .env.local.'
    );
  }
  return new OSS({
    region: OSS_REGION,
    bucket: OSS_BUCKET,
    accessKeyId: OSS_ACCESS_KEY_ID,
    accessKeySecret: OSS_ACCESS_KEY_SECRET,
    // internal=true 时 ali-oss 自动改用同地域内网 endpoint（-internal），免 OSS 公网流出流量费
    ...(internal ? { internal: true } : {})
  });
}

/**
 * 公网客户端：用于**下发给浏览器/外部服务**的签名 URL（资产预览、下载 302、百炼参考图）。
 * 这些 URL 的 host 必须公网可解析，故固定公网 endpoint，不受 OSS_INTERNAL 影响。
 */
export function getOssClient(): OSS {
  publicClient ??= createOssClient(false);
  return publicClient;
}

/**
 * 服务端字节操作客户端：上传 / 删除 / 服务端拉取（/raw 代理、头像代理）。
 * 部署在阿里云（ECS 与 OSS 同地域）时置 `OSS_INTERNAL=true` 走内网——免公网流出流量费且更快；
 * 未开启（含本地开发）时复用公网客户端，行为与从前完全一致。
 * 注意：经此签发的 URL 是内网地址，只可用于服务端自身 fetch（见 getServerFetchUrl），**绝不可下发**。
 */
export function getOssServerClient(): OSS {
  if (process.env.OSS_INTERNAL !== 'true') return getOssClient();
  serverClient ??= createOssClient(true);
  return serverClient;
}

/** 资产对象的存储路径约定（服务端写入路径；路径约定的变更需同步清理旧前缀对象） */
export function assetObjectKey(userId: string, assetId: string, extension: string): string {
  return `assets/${userId}/${assetId}.${extension}`;
}

/**
 * 用户头像对象的存储路径约定（仿 assetObjectKey）。
 * 单 key 覆盖写——换头像即覆盖同一对象，无版本累积、无垃圾残留。
 * 扩展名固定 png：上传经 sharp 统一规格化为 png（见 features/profile/lib/avatar.ts）。
 */
export function avatarObjectKey(userId: string): string {
  return `avatars/${userId}.png`;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  // 服务端上传：走 server client（OSS_INTERNAL=true 时经内网上传）
  await getOssServerClient().put(key, body, {
    headers: { 'Content-Type': contentType }
  });
}

/**
 * 生成带签名的临时访问 URL（私有 bucket 读取）。
 * response 覆盖参数可控制 OSS 返回的响应头（如附件下载文件名）。
 * 注意：OSS 不允许覆盖 content-type（response-content-type 会报 400
 * "Can not override response header on content-type"），对象上传时已固化 Content-Type。
 */
export async function getSignedUrl(
  key: string,
  expiresInSeconds = 3600,
  response?: { contentDisposition?: string }
): Promise<string> {
  return getOssClient().signatureUrl(key, {
    expires: expiresInSeconds,
    ...(response?.contentDisposition && {
      response: { 'content-disposition': response.contentDisposition }
    })
  });
}

/**
 * 服务端拉取专用签名 URL：与 getSignedUrl 同源，但走 server client——
 * 部署置 `OSS_INTERNAL=true` 时签发内网地址，服务端 fetch OSS 字节走内网（免公网流出流量费）。
 * **仅供服务端自身 fetch**；内网地址不可下发浏览器或外部服务（如百炼），后者用 getSignedUrl。
 */
export async function getServerFetchUrl(key: string, expiresInSeconds = 300): Promise<string> {
  return getOssServerClient().signatureUrl(key, { expires: expiresInSeconds });
}

/**
 * 缩略图统一宽度（等比缩放）：覆盖列表 36px（DPR 3 → 108）与设计选图弹窗 ~150px 格子
 * （DPR 2 → 300）；DPR 3 的网格会略软，但不影响插入尺寸（消费方只读宽高比）。
 * 不分档参数化：那等于对外开一个免费的图片处理接口，收益只有几 KB。
 */
export const THUMB_IMAGE_WIDTH = 320;

/**
 * 图片缩略图签名 URL（OSS 原生图片处理，零依赖零额外存储）。
 *
 * 列表行首 36px 与「插入图片」网格若直拉原图（AI 产出多为 1K~2K 档、1~2MB/张），
 * 一页就是十几 MB 的函数出口带宽；改由 OSS 等比缩放后单张只剩十几 KB。
 *
 * 只用 `image/resize,w_N`（**等比缩放、不裁切**）：消费方（画布插入/替换）按 naturalWidth/Height
 * 反推宽高比，裁切模式（m_fill）会破坏比例导致插入尺寸错误。
 * process 必须经 signatureUrl 选项纳入签名（同 videoSnapshotUrl，先签名再手拼会 SignatureDoesNotMatch）。
 */
export function imageThumbUrl(
  storageKey: string,
  options?: {
    /** 输出宽度（高度按比例），默认 THUMB_IMAGE_WIDTH */
    width?: number;
    /** 签名有效期（秒），默认 300（足够一次拉取） */
    expiresInSeconds?: number;
    /** true = 服务端拉取专用（内网优先），仅 /raw 代理使用；内网 URL 不可下发 */
    internal?: boolean;
  }
): string {
  const width = options?.width ?? THUMB_IMAGE_WIDTH;
  const expiresInSeconds = options?.expiresInSeconds ?? 300;
  const client = options?.internal ? getOssServerClient() : getOssClient();
  return client.signatureUrl(storageKey, {
    expires: expiresInSeconds,
    process: `image/resize,w_${width}`
  });
}

/**
 * 视频截帧封面签名 URL（OSS 原生视频截帧，零成本零依赖零存储）。
 *
 * 通过 signatureUrl 的 process 选项下发 `x-oss-process=video/snapshot`，该参数会被纳入签名
 * （私有桶必需；不能先签名再手动拼接 &x-oss-process，否则 SignatureDoesNotMatch）。
 * 返回的是同步签名字符串（signatureUrl 为同步 API）。
 *
 * 参数默认值（列表缩略图）：第 1 秒截帧、jpg、宽 400px、fast 关键帧模式。
 */
export function videoSnapshotUrl(
  storageKey: string,
  options?: {
    /** 截帧时间（毫秒），默认 1000（第 1 秒，避开黑屏开场） */
    time?: number;
    /** 输出宽度（高度自动按比例），默认 400 */
    width?: number;
    /** 输出格式，默认 jpg */
    format?: 'jpg' | 'png';
    /** 截帧模式，默认 fast（关键帧，更快） */
    mode?: 'fast' | 'accurate';
    /** 签名有效期（秒），默认 3600 */
    expiresInSeconds?: number;
    /** true = 服务端拉取专用（内网优先），仅 /raw 代理使用；内网 URL 不可下发 */
    internal?: boolean;
  }
): string {
  const time = options?.time ?? 1000;
  const width = options?.width ?? 400;
  const format = options?.format ?? 'jpg';
  const mode = options?.mode ?? 'fast';
  const expiresInSeconds = options?.expiresInSeconds ?? 3600;
  const client = options?.internal ? getOssServerClient() : getOssClient();
  return client.signatureUrl(storageKey, {
    expires: expiresInSeconds,
    process: `video/snapshot,t_${time},f_${format},w_${width},m_${mode}`
  });
}
