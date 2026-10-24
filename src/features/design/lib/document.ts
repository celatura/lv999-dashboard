import { OBJECT_DEFAULTS } from '../constants/canvas';
import {
  designDocumentSchema,
  type DesignDocument,
  type DesignObject,
  type ImageObject
} from '../api/types';

/**
 * 文档纯数据操作（无 Konva 依赖）：对象工厂、层级重排、文档解析。
 * 保持文档自持有可序列化——Konva 节点只在交互结束时把值写回这里。
 */

let idCounter = 0;

/** 生成文档内唯一对象 id（优先 crypto.randomUUID，回退计数器） */
export function generateObjectId(): string {
  idCounter += 1;
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }
  return `obj-${Date.now().toString(36)}-${idCounter}`;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * 新建图形/文字对象，使其视觉中心落在 center。
 * Konva 中 Rect/Text 的 x,y 为左上角、Circle 的 x,y 为圆心，故按类型偏移。
 */
export function createShapeObject(type: 'rect' | 'circle' | 'text', center: Point): DesignObject {
  const id = generateObjectId();
  if (type === 'rect') {
    const d = OBJECT_DEFAULTS.rect;
    return {
      id,
      type: 'rect',
      x: center.x - d.width / 2,
      y: center.y - d.height / 2,
      rotation: 0,
      width: d.width,
      height: d.height,
      fill: d.fill,
      cornerRadius: d.cornerRadius
    };
  }
  if (type === 'circle') {
    const d = OBJECT_DEFAULTS.circle;
    return {
      id,
      type: 'circle',
      x: center.x,
      y: center.y,
      rotation: 0,
      radius: d.radius,
      fill: d.fill
    };
  }
  const d = OBJECT_DEFAULTS.text;
  // 文字宽度未知，按字号粗略估算居中偏移
  const approxWidth = d.text.length * d.fontSize * 0.6;
  return {
    id,
    type: 'text',
    x: center.x - approxWidth / 2,
    y: center.y - d.fontSize / 2,
    rotation: 0,
    text: d.text,
    fontSize: d.fontSize,
    fill: d.fill,
    fontStyle: d.fontStyle,
    align: d.align
  };
}

/**
 * 新建图片对象：按自然尺寸等比缩放到 maxBox 内（保持宽高比），中心落在 center。
 * natural 缺省（缩略图尚未加载）时回退为正方形。
 */
export function createImageObject(
  assetId: string,
  center: Point,
  natural: { width: number; height: number } | null,
  maxBox = 600
): ImageObject {
  const ratio = natural && natural.height > 0 ? natural.width / natural.height : 1;
  let width = maxBox;
  let height = maxBox;
  if (ratio >= 1) {
    width = maxBox;
    height = maxBox / ratio;
  } else {
    height = maxBox;
    width = maxBox * ratio;
  }
  return {
    id: generateObjectId(),
    type: 'image',
    x: center.x - width / 2,
    y: center.y - height / 2,
    rotation: 0,
    assetId,
    width: Math.round(width),
    height: Math.round(height)
  };
}

/** 图片对象「换图」补丁（AI 改图替换当前对象用）；结构上即 ObjectPatch 的子集 */
export interface ImageReplacePatch {
  assetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * AI 改图「替换当前对象」的补丁：只换 assetId 引用（Konva 铁律，不存字节），
 * 并按新图自然尺寸**等比适配原外接框**（新图比例可能与源不同，绝不拉伸变形），
 * 视觉中心保持不变（含旋转：Konva 绕节点原点 (x,y) 旋转，故按旋转后的中心反推新原点）。
 *
 * natural 缺省（/raw 尚未就绪）时仅换引用、沿用原框：未指定输出比例的 I2I 延续源图构图，
 * 比例通常与源一致，沿用原框比强行按正方形适配更不易变形。
 */
export function imageReplacePatch(
  object: ImageObject,
  assetId: string,
  natural: { width: number; height: number } | null
): ImageReplacePatch {
  if (!natural || natural.width <= 0 || natural.height <= 0) {
    return { assetId, x: object.x, y: object.y, width: object.width, height: object.height };
  }
  // contain：缩放至完全落入原外接框（不裁切、不变形）
  const scale = Math.min(object.width / natural.width, object.height / natural.height);
  const width = Math.max(1, Math.round(natural.width * scale));
  const height = Math.max(1, Math.round(natural.height * scale));

  const rad = ((object.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // 旋转后的局部中心偏移（y 轴向下，正角为顺时针，与 Konva 一致）
  const oldOffset = { x: object.width / 2, y: object.height / 2 };
  const newOffset = { x: width / 2, y: height / 2 };
  const rotate = (offset: Point): Point => ({
    x: offset.x * cos - offset.y * sin,
    y: offset.x * sin + offset.y * cos
  });
  const center = {
    x: object.x + rotate(oldOffset).x,
    y: object.y + rotate(oldOffset).y
  };
  const placed = rotate(newOffset);
  return {
    assetId,
    x: center.x - placed.x,
    y: center.y - placed.y,
    width,
    height
  };
}

/** 层级重排：forward 上移一层 / backward 下移一层（数组末尾为最上层） */
export function reorderObject(
  objects: DesignObject[],
  id: string,
  direction: 'forward' | 'backward'
): DesignObject[] {
  const index = objects.findIndex((object) => object.id === id);
  if (index < 0) return objects;
  const target = direction === 'forward' ? index + 1 : index - 1;
  if (target < 0 || target >= objects.length) return objects;
  const next = objects.slice();
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

/**
 * 批量层级重排：把选中的一组对象整体前/后移一层，保持组内相对顺序。
 * 逐位扫描并与相邻的「非选中」对象交换一次（forward 自顶向下、backward 自底向上），
 * 保证每个选中项恰好移动一步；无可移动项时原样返回（引用不变，供 reducer 跳过入历史）。
 */
export function reorderObjects(
  objects: DesignObject[],
  ids: string[],
  direction: 'forward' | 'backward'
): DesignObject[] {
  if (ids.length === 0) return objects;
  const idSet = new Set(ids);
  const next = objects.slice();
  let moved = false;
  if (direction === 'forward') {
    for (let i = next.length - 2; i >= 0; i--) {
      if (idSet.has(next[i].id) && !idSet.has(next[i + 1].id)) {
        [next[i], next[i + 1]] = [next[i + 1], next[i]];
        moved = true;
      }
    }
  } else {
    for (let i = 1; i < next.length; i++) {
      if (idSet.has(next[i].id) && !idSet.has(next[i - 1].id)) {
        [next[i], next[i - 1]] = [next[i - 1], next[i]];
        moved = true;
      }
    }
  }
  return moved ? next : objects;
}

/** 轴对齐包围盒（文档坐标） */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 以 (originX, originY) 为旋转中心、按角度（度）展开四角后的 AABB。
 * 与 Konva `Node#getClientRect` 的内核同构（`Transform#_getTransformedRect`：
 * 四角变换后取 min/max）；Konva 的 Rect/Text/Image 绕节点左上角 (x,y) 旋转，
 * 正角为顺时针（y 轴向下）。
 * 注：仅复刻变换内核；不含 strokeWidth / shadow，Text 的宽高为估算而非 measureText。
 */
function rotatedBox(
  originX: number,
  originY: number,
  width: number,
  height: number,
  rotation: number
): Box {
  if (!rotation) return { x: originX, y: originY, width, height };
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const corners: [number, number][] = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height]
  ];
  for (const [localX, localY] of corners) {
    const x = originX + localX * cos - localY * sin;
    const y = originY + localX * sin + localY * cos;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * 对象的轴对齐包围盒（吸附/对齐共用的几何口径）。
 * 旋转对象按旋转后的四角计算真实 AABB；Circle 旋转不改变包围盒。
 * 文字宽高按字号与行数估算（Konva 未渲染时的近似度量）。
 */
export function objectBounds(object: DesignObject): Box {
  switch (object.type) {
    case 'rect':
    case 'image':
      return rotatedBox(object.x, object.y, object.width, object.height, object.rotation);
    case 'circle':
      return {
        x: object.x - object.radius,
        y: object.y - object.radius,
        width: object.radius * 2,
        height: object.radius * 2
      };
    case 'text': {
      const lines = object.text.split('\n');
      const longest = lines.reduce((max, line) => Math.max(max, line.length), 1);
      const width = object.width ?? Math.max(1, longest * object.fontSize * 0.6);
      const height = Math.max(1, lines.length) * object.fontSize * 1.2;
      return rotatedBox(object.x, object.y, width, height, object.rotation);
    }
  }
}

/** 求若干包围盒的并集（多选取舍的整体框）；空数组返回 null */
export function unionBox(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * 克隆对象用于复制/粘贴：强制生成新 id（绝不复用源 id），位置按 offset 平移。
 * 图片对象只克隆 assetId 引用（不复制字节，符合 Konva 铁律）。
 */
export function cloneObjectWithOffset(object: DesignObject, offset: number): DesignObject {
  return {
    ...object,
    id: generateObjectId(),
    x: object.x + offset,
    y: object.y + offset
  } as DesignObject;
}

/** 解析并校验已存文档 JSON；无效返回 null（调用方回退空白文档） */
export function parseDesignDocument(content: string | null | undefined): DesignDocument | null {
  if (!content) return null;
  try {
    const parsed = designDocumentSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
