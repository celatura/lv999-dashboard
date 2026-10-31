'use client';

import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api-client';
import { clamp } from '@/lib/utils';
import { createDesignMutation, updateDesignMutation } from '../api/mutations';
import type { DesignDocument, DesignObject } from '../api/types';
import { ZOOM_MAX, ZOOM_MIN } from '../constants/canvas';
import {
  useEditorReducer,
  type ObjectPatch,
  type ObjectPatchEntry
} from '../hooks/use-editor-reducer';
import { assetRawUrl } from '../hooks/use-asset-image';
import { createImageObject, createShapeObject, type Point } from './document';
import { downloadDataURL, exportPreviewBase64, exportStageToDataURL } from './export';

interface EditorContextValue {
  // 文档与选择
  document: DesignDocument;
  objects: DesignObject[];
  selectedIds: string[];
  selectedObjects: DesignObject[];
  /** 主选对象（选中集首个派生）；无选中为 null */
  selectedObject: DesignObject | null;
  canUndo: boolean;
  canRedo: boolean;
  canPaste: boolean;
  isDirty: boolean;

  // 选择（稳定回调）
  select: (ids: string[]) => void;
  toggleSelect: (id: string) => void;
  clearSelection: () => void;

  // 对象操作（稳定回调）
  commitObject: (id: string, patch: ObjectPatch) => void;
  commitObjects: (patches: ObjectPatchEntry[]) => void;
  removeObject: (id: string) => void;
  removeObjects: (ids: string[]) => void;
  reorder: (id: string, direction: 'forward' | 'backward') => void;
  reorderMany: (ids: string[], direction: 'forward' | 'backward') => void;
  updateDocument: (patch: Partial<Pick<DesignDocument, 'width' | 'height' | 'background'>>) => void;
  undo: () => void;
  redo: () => void;
  addShape: (type: 'rect' | 'circle' | 'text') => void;
  insertImage: (assetId: string, natural: { width: number; height: number } | null) => void;

  // 复制粘贴（会话内剪贴板，不持久化到系统剪贴板）
  copySelection: () => void;
  paste: () => void;
  duplicate: () => void;

  // 相机（缩放/平移）
  zoom: number;
  position: Point;
  stageRef: RefObject<Konva.Stage | null>;
  containerSize: { width: number; height: number };
  setContainerSize: (size: { width: number; height: number }) => void;
  handleWheel: (event: KonvaEventObject<WheelEvent>) => void;
  panTo: (position: Point) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fitToScreen: () => void;

  // 文字编辑 overlay
  editingTextId: string | null;
  startTextEdit: (id: string) => void;
  endTextEdit: () => void;
  commitText: (id: string, text: string) => void;

  // 资产与保存
  assetId: string | null;
  title: string;
  setTitle: (title: string) => void;
  isSaving: boolean;
  save: () => Promise<void>;
  exportPng: () => void;
}

const EditorContext = createContext<EditorContextValue | null>(null);

/** 复制/粘贴的默认偏移（px，文档坐标）；连续粘贴按次数累加避免重叠 */
const PASTE_OFFSET = 24;

interface EditorProviderProps {
  /** 已存 design 资产 id；新建时为 null */
  assetId: string | null;
  initialTitle: string;
  initialDocument: DesignDocument;
  /** 预置图片资产 id（「在画布使用」入口）；挂载时插入画布，不自动保存 */
  initialImageAssetId?: string | null;
  /** 打开时是否已有预览 PNG（= asset.storageKey 非空）；决定无改动保存时能否跳过预览重导 */
  initialHasPreview?: boolean;
  children: ReactNode;
}

export function EditorProvider({
  assetId,
  initialTitle,
  initialDocument,
  initialImageAssetId,
  initialHasPreview = false,
  children
}: EditorProviderProps) {
  const router = useRouter();
  const [state, dispatch] = useEditorReducer(initialDocument);
  const [title, setTitle] = useState(initialTitle);

  // 相机：state 供渲染（Stage 受控 + overlay 定位 + 工具栏百分比）；ref 供事件处理同步读取（快速滚轮不丢帧）
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState<Point>({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const positionRef = useRef<Point>({ x: 0, y: 0 });

  const [containerSize, setContainerSizeState] = useState({ width: 0, height: 0 });
  const containerSizeRef = useRef({ width: 0, height: 0 });

  const [editingTextId, setEditingTextId] = useState<string | null>(null);

  // 会话内剪贴板：ref 存快照（复制不触发重渲染），count 供工具栏按钮 disabled 反应
  const clipboardRef = useRef<DesignObject[]>([]);
  const pasteCountRef = useRef(0);
  const [clipboardCount, setClipboardCount] = useState(0);

  const stageRef = useRef<Konva.Stage | null>(null);

  // latest refs：让 save/export/相机回调保持稳定引用（读最新值）
  const stateRef = useRef(state);
  stateRef.current = state;
  const titleRef = useRef(title);
  titleRef.current = title;
  const createdIdRef = useRef<string | null>(null);
  // 上次成功保存的文档快照：用 state（而非 ref）才能让 isDirty 在保存后正确重算，
  // 并使 memo 依赖与读取值一致
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(initialDocument));
  // 当前是否已有预览 PNG（语义：预览与已保存文档一致；本次尝试导出失败则仍为 false）
  const hasPreviewRef = useRef(initialHasPreview);
  // 保存 in-flight 闸门（见 save）
  const savingRef = useRef(false);
  const hasFittedRef = useRef(false);

  const { mutateAsync: createDesign, isPending: isCreating } = useMutation(createDesignMutation);
  const { mutateAsync: updateDesign, isPending: isUpdating } = useMutation(updateDesignMutation);

  const applyCamera = useCallback((nextZoom: number, nextPosition: Point) => {
    zoomRef.current = nextZoom;
    positionRef.current = nextPosition;
    setZoom(nextZoom);
    setPosition(nextPosition);
  }, []);

  const setContainerSize = useCallback((size: { width: number; height: number }) => {
    containerSizeRef.current = size;
    setContainerSizeState(size);
  }, []);

  /** 视口中心对应的文档坐标（新对象放置点） */
  const getViewportCenter = useCallback((): Point => {
    const { width, height } = containerSizeRef.current;
    const doc = stateRef.current.present;
    if (!width || !height) return { x: doc.width / 2, y: doc.height / 2 };
    const scale = zoomRef.current;
    return {
      x: (width / 2 - positionRef.current.x) / scale,
      y: (height / 2 - positionRef.current.y) / scale
    };
  }, []);

  const fitToScreen = useCallback(() => {
    const { width, height } = containerSizeRef.current;
    if (!width || !height) return;
    const doc = stateRef.current.present;
    const padding = 48;
    const scale = clamp(
      Math.min((width - padding * 2) / doc.width, (height - padding * 2) / doc.height),
      ZOOM_MIN,
      ZOOM_MAX
    );
    applyCamera(scale, {
      x: (width - doc.width * scale) / 2,
      y: (height - doc.height * scale) / 2
    });
  }, [applyCamera]);

  // 首次量到容器尺寸时自适应
  useEffect(() => {
    if (hasFittedRef.current) return;
    if (containerSize.width > 0 && containerSize.height > 0) {
      hasFittedRef.current = true;
      fitToScreen();
    }
  }, [containerSize, fitToScreen]);

  const select = useCallback((ids: string[]) => dispatch({ type: 'select', ids }), [dispatch]);
  const toggleSelect = useCallback(
    (id: string) => dispatch({ type: 'toggle-select', id }),
    [dispatch]
  );
  const clearSelection = useCallback(() => dispatch({ type: 'clear-select' }), [dispatch]);
  const commitObject = useCallback(
    (id: string, patch: ObjectPatch) => dispatch({ type: 'update-object', id, patch }),
    [dispatch]
  );
  const commitObjects = useCallback(
    (patches: ObjectPatchEntry[]) => dispatch({ type: 'update-objects', patches }),
    [dispatch]
  );
  const removeObject = useCallback(
    (id: string) => dispatch({ type: 'remove-objects', ids: [id] }),
    [dispatch]
  );
  const removeObjects = useCallback(
    (ids: string[]) => dispatch({ type: 'remove-objects', ids }),
    [dispatch]
  );
  const reorder = useCallback(
    (id: string, direction: 'forward' | 'backward') => dispatch({ type: 'reorder', id, direction }),
    [dispatch]
  );
  const reorderMany = useCallback(
    (ids: string[], direction: 'forward' | 'backward') =>
      dispatch({ type: 'reorder-many', ids, direction }),
    [dispatch]
  );

  // 复制选中到会话内剪贴板（浅拷贝快照；不入文档、不入历史）
  const copySelection = useCallback(() => {
    const current = stateRef.current;
    const idSet = new Set(current.selectedIds);
    const snapshots = current.present.objects
      .filter((object) => idSet.has(object.id))
      .map((object) => ({ ...object }) as DesignObject);
    clipboardRef.current = snapshots;
    pasteCountRef.current = 0;
    setClipboardCount(snapshots.length);
  }, []);

  // 粘贴：读剪贴板快照 → reducer 克隆新 id + 累加偏移 → 选中新副本（一条历史）
  const paste = useCallback(() => {
    const clipboard = clipboardRef.current;
    if (clipboard.length === 0) return;
    pasteCountRef.current += 1;
    dispatch({
      type: 'paste-objects',
      objects: clipboard,
      offset: PASTE_OFFSET * pasteCountRef.current
    });
  }, [dispatch]);

  // 直接复制选中并偏移（Ctrl+D）：不经剪贴板；重复按下因选中的是新副本而自然级联
  const duplicate = useCallback(() => {
    const current = stateRef.current;
    if (current.selectedIds.length === 0) return;
    dispatch({ type: 'duplicate-objects', ids: current.selectedIds, offset: PASTE_OFFSET });
  }, [dispatch]);
  const updateDocument = useCallback(
    (patch: Partial<Pick<DesignDocument, 'width' | 'height' | 'background'>>) =>
      dispatch({ type: 'update-document', patch }),
    [dispatch]
  );
  const undo = useCallback(() => dispatch({ type: 'undo' }), [dispatch]);
  const redo = useCallback(() => dispatch({ type: 'redo' }), [dispatch]);

  const addShape = useCallback(
    (type: 'rect' | 'circle' | 'text') => {
      const object = createShapeObject(type, getViewportCenter());
      dispatch({ type: 'add-object', object });
    },
    [dispatch, getViewportCenter]
  );

  const insertImage = useCallback(
    (imageAssetId: string, natural: { width: number; height: number } | null) => {
      const object = createImageObject(imageAssetId, getViewportCenter(), natural);
      dispatch({ type: 'add-object', object });
    },
    [dispatch, getViewportCenter]
  );

  // 「在画布使用」预置图片：挂载后经同源 /raw 代理加载取自然尺寸，
  // 复用 insertImage 按比例适配并居中插入（不自动保存，等用户操作）。
  // load 回调经 Effect Event 调用 insertImage：始终读最新实现，
  // 其引用变化不再触发 effect 重跑；initialImageAssetId 保留为响应式依赖
  const initialImageInsertedRef = useRef(false);
  const insertImageEvent = useEffectEvent(insertImage);
  useEffect(() => {
    if (!initialImageAssetId || initialImageInsertedRef.current) return;
    initialImageInsertedRef.current = true;
    const image = new window.Image();
    image.addEventListener('load', () => {
      insertImageEvent(initialImageAssetId, {
        width: image.naturalWidth,
        height: image.naturalHeight
      });
    });
    image.addEventListener('error', () => {
      toast.error('预置图片加载失败，可在工具栏「插入图片」中重新选择');
    });
    image.src = assetRawUrl(initialImageAssetId);
  }, [initialImageAssetId]);

  const zoomBy = useCallback(
    (factor: number) => {
      const { width, height } = containerSizeRef.current;
      const oldScale = zoomRef.current;
      const newScale = clamp(oldScale * factor, ZOOM_MIN, ZOOM_MAX);
      if (newScale === oldScale) return;
      // 相对视口中心缩放
      const center = { x: width / 2, y: height / 2 };
      const docPoint = {
        x: (center.x - positionRef.current.x) / oldScale,
        y: (center.y - positionRef.current.y) / oldScale
      };
      applyCamera(newScale, {
        x: center.x - docPoint.x * newScale,
        y: center.y - docPoint.y * newScale
      });
    },
    [applyCamera]
  );

  const zoomIn = useCallback(() => zoomBy(1.2), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(1 / 1.2), [zoomBy]);

  /** 平移提交：Stage 拖拽结束时把命令式位置写回相机状态 */
  const panTo = useCallback((next: Point) => applyCamera(zoomRef.current, next), [applyCamera]);

  // 相对指针缩放（Konva 官方范式）
  const handleWheel = useCallback(
    (event: KonvaEventObject<WheelEvent>) => {
      event.evt.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      const oldScale = zoomRef.current;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const factor = event.evt.deltaY > 0 ? 1 / 1.1 : 1.1;
      const newScale = clamp(oldScale * factor, ZOOM_MIN, ZOOM_MAX);
      if (newScale === oldScale) return;
      const docPoint = {
        x: (pointer.x - positionRef.current.x) / oldScale,
        y: (pointer.y - positionRef.current.y) / oldScale
      };
      applyCamera(newScale, {
        x: pointer.x - docPoint.x * newScale,
        y: pointer.y - docPoint.y * newScale
      });
    },
    [applyCamera]
  );

  const startTextEdit = useCallback((id: string) => setEditingTextId(id), []);
  const endTextEdit = useCallback(() => setEditingTextId(null), []);
  const commitText = useCallback(
    (id: string, text: string) => {
      dispatch({ type: 'update-object', id, patch: { text } });
      setEditingTextId(null);
    },
    [dispatch]
  );

  const exportPng = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    try {
      // 不传 maxPixelRatio → 默认 1（只缩不放）：导出尺寸 = 画布原尺寸，超大画布才按 2560 缩边
      const dataUrl = exportStageToDataURL(stage, stateRef.current.present, {
        maxDimension: 2560
      });
      const safeTitle = titleRef.current.replace(/[\\/:*?"<>|]/g, '-').trim() || '未命名设计';
      downloadDataURL(dataUrl, `${safeTitle}.png`);
    } catch (error) {
      console.error('[design] export failed', error);
      toast.error('导出失败，请重试');
    }
  }, []);

  const save = useCallback(async () => {
    // 并发闸门：工具栏按钮有 disabled={isSaving}，但 Ctrl/Cmd+S 的 keydown 不受 isSaving 约束
    // （按住不放会连续触发），而一次保存要同步导出 + 上传 2.5MB 级 base64，窗口达秒级；
    // 新建页上重复保存会开出两条资产。
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      const stage = stageRef.current;
      const doc = stateRef.current.present;
      const currentTitle = titleRef.current.trim() || '未命名设计';

      // 导出预览 PNG（失败不阻塞保存：文档本身仍完整落库）
      // 阶梯内优先画布原尺寸（不放大）——这张 PNG 同时是资产列表的**下载产物**。
      // 仅在「文档真有改动」或「此前没有预览」时才导出：预览上传是 2.5MB 级且 toDataURL 同步
      // 阻塞主线程，只改标题或重复保存时不必重做（服务端 updateDesignAsset 按 previewPng 存在性更新）。
      const dirty = JSON.stringify(doc) !== savedSnapshot;
      const needPreview = dirty || !hasPreviewRef.current;
      let previewPng: string | undefined;
      if (stage && needPreview) {
        try {
          previewPng = exportPreviewBase64(stage, doc);
        } catch (error) {
          console.error('[design] preview export failed', error);
        }
      }

      const existingId = createdIdRef.current ?? assetId;
      if (existingId) {
        await updateDesign({
          id: existingId,
          values: { title: currentTitle, document: doc, previewPng }
        });
        setSavedSnapshot(JSON.stringify(doc));
        // hasPreview 语义是「预览与已存文档一致」：仅当本次尝试过导出才由结果决定
        // （尝试了但失败/超预算→ false，下次保存会补导；未尝试→ 维持原值）。
        if (needPreview) hasPreviewRef.current = Boolean(previewPng);
        toast.success('已保存');
      } else {
        const { id } = await createDesign({ title: currentTitle, document: doc, previewPng });
        createdIdRef.current = id;
        setSavedSnapshot(JSON.stringify(doc));
        if (needPreview) hasPreviewRef.current = Boolean(previewPng);
        toast.success('已创建');
        // 真实导航进入 [id]（沿用 agent 新建会话范式）；页面会以刚保存的文档重新挂载
        router.replace(`/dashboard/design/${id}`);
      }
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 429
          ? '操作过于频繁，请稍后再试'
          : error instanceof ApiError && error.status === 413
            ? '预览图过大，保存失败'
            : '保存失败，请重试';
      toast.error(message);
    } finally {
      savingRef.current = false;
    }
  }, [assetId, createDesign, updateDesign, router, savedSnapshot]);

  // 键盘快捷键（文字编辑态让位于原生输入，避免抢键/破坏 IME）。
  // 整体作为 Effect Event：处理时读最新 state/回调（editingTextId、save、undo 等），
  // 监听仅在挂载时注册一次，不随这些回调的引用变化反复解绑/绑定
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (editingTextId) {
      if (event.key === 'Escape') endTextEdit();
      return;
    }
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return;
    }
    // 弹层打开时整体让位（插入图片 / AI 生成 / AI 修改 / 命令面板，均为 role='dialog'）：
    // 焦点在弹层内时 Delete、方向键、Ctrl+C/V/D 不应改动画布（否则选中对象会被误删）
    if (document.querySelector('[role="dialog"]')) {
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod) {
      switch (key) {
        case 's':
          event.preventDefault();
          void save();
          return;
        case 'z':
          event.preventDefault();
          if (event.shiftKey) redo();
          else undo();
          return;
        case 'y':
          event.preventDefault();
          redo();
          return;
        case 'c':
          event.preventDefault();
          copySelection();
          return;
        case 'v':
          event.preventDefault();
          paste();
          return;
        case 'd':
          // Ctrl+D 默认为浏览器书签，必须 preventDefault
          event.preventDefault();
          duplicate();
          return;
        default:
          break;
      }
    }
    if (event.key === 'Escape') {
      clearSelection();
      return;
    }
    const current = stateRef.current;
    if (current.selectedIds.length === 0) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      removeObjects(current.selectedIds);
      return;
    }
    const arrows: Record<string, Point> = {
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 }
    };
    const delta = arrows[event.key];
    if (delta) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const idSet = new Set(current.selectedIds);
      const patches = current.present.objects
        .filter((object) => idSet.has(object.id))
        .map((object) => ({
          id: object.id,
          patch: { x: object.x + delta.x * step, y: object.y + delta.y * step }
        }));
      if (patches.length > 0) commitObjects(patches);
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const selectedObjects = useMemo(() => {
    if (state.selectedIds.length === 0) return [];
    const idSet = new Set(state.selectedIds);
    return state.present.objects.filter((object) => idSet.has(object.id));
  }, [state.present.objects, state.selectedIds]);

  const selectedObject = selectedObjects.length > 0 ? selectedObjects[0] : null;

  /**
   * 脏位比对：memo 化避免每次 provider render（含滚轮缩放/平移）都 stringify 整份文档。
   * 依赖 savedSnapshot 保证保存成功后（present 引用未变）能重算为 false。
   */
  const isDirty = useMemo(
    () => JSON.stringify(state.present) !== savedSnapshot,
    [state.present, savedSnapshot]
  );

  const value = useMemo<EditorContextValue>(
    () => ({
      document: state.present,
      objects: state.present.objects,
      selectedIds: state.selectedIds,
      selectedObjects,
      selectedObject,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      canPaste: clipboardCount > 0,
      isDirty,
      select,
      toggleSelect,
      clearSelection,
      commitObject,
      commitObjects,
      removeObject,
      removeObjects,
      reorder,
      reorderMany,
      updateDocument,
      undo,
      redo,
      addShape,
      insertImage,
      copySelection,
      paste,
      duplicate,
      zoom,
      position,
      stageRef,
      containerSize,
      setContainerSize,
      handleWheel,
      panTo,
      zoomIn,
      zoomOut,
      fitToScreen,
      editingTextId,
      startTextEdit,
      endTextEdit,
      commitText,
      assetId,
      title,
      setTitle,
      isSaving: isCreating || isUpdating,
      save,
      exportPng
    }),
    [
      state,
      selectedObjects,
      selectedObject,
      clipboardCount,
      isDirty,
      select,
      toggleSelect,
      clearSelection,
      commitObject,
      commitObjects,
      removeObject,
      removeObjects,
      reorder,
      reorderMany,
      updateDocument,
      undo,
      redo,
      addShape,
      insertImage,
      copySelection,
      paste,
      duplicate,
      zoom,
      position,
      containerSize,
      setContainerSize,
      handleWheel,
      panTo,
      zoomIn,
      zoomOut,
      fitToScreen,
      editingTextId,
      startTextEdit,
      endTextEdit,
      commitText,
      assetId,
      title,
      isCreating,
      isUpdating,
      save,
      exportPng
    ]
  );

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export function useEditor(): EditorContextValue {
  const context = useContext(EditorContext);
  if (!context) {
    throw new Error('useEditor must be used within an EditorProvider');
  }
  return context;
}
