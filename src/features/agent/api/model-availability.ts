import { MODEL_NOT_FOUND_MESSAGE, MODEL_RETIRED_MESSAGE } from '../constants/models';
import { errorHaystack } from './generation-error';

/**
 * 模型可用性识别（server-only）：把「模型已下线 / 未开通 / 不存在」从「鉴权失败」里摘出来。
 *
 * 为什么要单独识别：百炼的模型下线报错**不含「已下线」字样** ——
 * 调用已下线（或账号未开通）的模型返回 403 + `access_denied`，调用不存在的模型名返回
 * 404 + `Model not exist`。若按状态码笼统归入鉴权分支，排查会一路去查 API Key，
 * 而真正要做的动作是换模型 ID（改 constants/models.ts 等注册表）。
 * 参考下线机制：https://help.aliyun.com/zh/model-studio/model-depreciation
 *
 * 命中时统一以 `[agent] model unavailable` 打日志，可直接按该前缀配监控告警
 * （批量退役在监控上表现为一堆看似无关的 403，见 docs/agent.md「模型注册表」节）。
 */

/** 模型名不存在（已下架或 ID 变更）——404 需有该信号佐证，避免把路径写错也报成模型问题 */
const NOT_FOUND_RE = /not\s*exist|does\s*not\s*exist|not_found|notfound|model_not_found/i;

/** 已下线 / 未开通 / 无权访问该模型 —— 403 类信号 */
const FORBIDDEN_RE = /access_denied|accessdenied|unpurchased|no\s*permission|nopermission/i;

/**
 * 账户侧 403（不是模型问题），必须优先排除，否则会把账单/权利问题说成模型下线：
 * - 欠费 / 服务停用：`Arrearage`、`isv.OUTOFSERVICE`
 * - 配额耗尽：`AllocationQuota.FreeTierOnly`（免费额度用尽，官方文案含 “on a paid basis”）
 * - 子业务空间无访问权限：`Workspace.AccessDenied`
 * 注意：不能裸匹配 `workspace`——模型下线端点也会返回 “Workspace endpoint access denied”，那类恰恰要判为模型不可用。
 */
const BILLING_RE =
  /arrearage|in\s*debt|insufficient\s*balance|insufficient_quota|allocationquota|isv\.outofservice|overdue/i;

/** 子空间/工作区权限问题（保留 `Workspace.AccessDenied` 而放过 `Endpoint.AccessDenied`） */
const WORKSPACE_RE = /workspace[.\s]?accessdenied|workspace\s+access\s+denied/i;

/** API Key 本身无效：交回原有的鉴权分支（含下划线变体） */
const AUTH_RE = /invalidapikey|invalid[_\s]?api[_\s]?key|incorrect[_\s]?api[_\s]?key/i;

function safeStringify(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    // 忽略无法序列化的响应体
    return '';
  }
}

/** 从上游错误对象提取 HTTP 状态码（AI SDK 的 APICallError 用 statusCode，fetch 系用 status） */
function extractStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined;
  const withStatus = error as { statusCode?: unknown; status?: unknown };
  const raw = withStatus.statusCode ?? withStatus.status;
  return typeof raw === 'number' ? raw : undefined;
}

/**
 * 判定上游失败是否属于「模型不可用」，是则返回面向用户的可操作中文，否则返回 null。
 * 返回 null 时调用方按原有错误映射继续处理（审核拒绝 / 限流 / 参数 / 鉴权等）。
 *
 * 上游响应体形态有两类，都能覆盖：
 * - 原生 REST（图片通道）：`{ code, message }` 或 `{ output: { code, message } }` → 传 `body` + `status`
 * - AI SDK（对话 / 视频 / embedding 通道）：APICallError 及其 cause 链 → 传 `error`
 */
export function detectModelUnavailable(params: {
  /** 调用通道，仅用于日志定位（chat / image / video / embedding） */
  channel: string;
  /** 上游 HTTP 状态码；不传时从 error 的 statusCode/status 读取 */
  status?: number;
  /** 上游响应体（原生 REST 或 OpenAI 兼容 JSON） */
  body?: unknown;
  /** 抛出的错误对象 */
  error?: unknown;
  /** 关联标识（会话 id / 文档 id / 模型 id 等），随日志输出便于定位 */
  detail?: Record<string, unknown>;
}): string | null {
  const status = params.status ?? extractStatus(params.error);
  const haystack = [
    safeStringify(params.body),
    params.error ? errorHaystack(params.error) : ''
  ].join(' ');

  // 账户侧问题（欠费 / 配额 / 子空间权限）与 Key 失效优先排除：这些换模型没用，必须走原有提示
  if (BILLING_RE.test(haystack) || WORKSPACE_RE.test(haystack) || AUTH_RE.test(haystack)) {
    return null;
  }

  let message: string | null = null;
  // 404 需同时命中「模型名不存在」信号，避免把网关路径问题也报成模型问题
  if (
    (status === 404 && NOT_FOUND_RE.test(haystack)) ||
    /model_not_found|modelnotfound/i.test(haystack)
  ) {
    message = MODEL_NOT_FOUND_MESSAGE;
  } else if (status === 403 || FORBIDDEN_RE.test(haystack)) {
    message = MODEL_RETIRED_MESSAGE;
  }
  if (!message) return null;

  console.error('[agent] model unavailable', {
    channel: params.channel,
    status,
    upstreamMessage: params.error instanceof Error ? params.error.message : undefined,
    ...params.detail
  });
  return message;
}
