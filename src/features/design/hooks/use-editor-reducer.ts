import { useReducer } from 'react';
import type { DesignDocument, DesignObject, TextAlign } from '../api/types';
import { cloneObjectWithOffset, reorderObject, reorderObjects } from '../lib/document';

/**
 * 编辑器状态 = 文档三段历史（past/present/future）+ 当前多选。
 *
 * 纪律（Konva 官方）：一次完整用户操作提交一条历史（拖拽/变换只在结束时 dispatch 一次），
 * 而非每个指针事件一条；选中变化不入历史。批量移动/删除/复制/对齐各 pushHistory 一次。
 */
export interface EditorState {
  past: DesignDocument[];
  present: DesignDocument;
  future: DesignDocument[];
  selectedIds: string[];
}

/** 对象可编辑字段的部分更新（几何 + 样式；不改 type/id） */
export type ObjectPatch = Partial<{
  x: number;
  y: number;
  rotation: number;
  fill: string;
  fontSize: number;
  fontStyle: string;
  /** 文字水平对齐（仅 text 对象有意义；配合换行宽度 width 生效） */
  align: TextAlign;
  cornerRadius: number;
  width: number;
  height: number;
  radius: number;
  text: string;
  /** 图片资产引用（仅 image 对象有意义）：AI 改图「替换当前对象」时改指新资产，仍不存字节 */
  assetId: string;
}>;

/** 批量更新的一项（id + 局部补丁） */
export interface ObjectPatchEntry {
  id: string;
  patch: ObjectPatch;
}

export type DocumentPatch = Partial<Pick<DesignDocument, 'width' | 'height' | 'background'>>;

export type EditorAction =
  | { type: 'set-document'; document: DesignDocument; selectedIds?: string[] }
  | { type: 'add-object'; object: DesignObject }
  | { type: 'add-objects'; objects: DesignObject[] }
  | { type: 'duplicate-objects'; ids: string[]; offset: number }
  | { type: 'paste-objects'; objects: DesignObject[]; offset: number }
  | { type: 'update-object'; id: string; patch: ObjectPatch }
  | { type: 'update-objects'; patches: ObjectPatchEntry[] }
  | { type: 'remove-objects'; ids: string[] }
  | { type: 'reorder'; id: string; direction: 'forward' | 'backward' }
  | { type: 'reorder-many'; ids: string[]; direction: 'forward' | 'backward' }
  | { type: 'update-document'; patch: DocumentPatch }
  | { type: 'select'; ids: string[] }
  | { type: 'toggle-select'; id: string }
  | { type: 'clear-select' }
  | { type: 'undo' }
  | { type: 'redo' };

/** 历史栈上限（文档为纯引用数据、体积小，仍设上限防无界增长） */
const HISTORY_LIMIT = 100;

function pushHistory(
  state: EditorState,
  present: DesignDocument,
  selectedIds: string[] = state.selectedIds
): EditorState {
  const past = [...state.past, state.present];
  if (past.length > HISTORY_LIMIT) past.shift();
  return { past, present, future: [], selectedIds };
}

/** undo/redo 后：过滤掉已不存在的选中 id */
function reconcileSelection(document: DesignDocument, selectedIds: string[]): string[] {
  if (selectedIds.length === 0) return selectedIds;
  const existing = new Set(document.objects.map((object) => object.id));
  const filtered = selectedIds.filter((id) => existing.has(id));
  return filtered.length === selectedIds.length ? selectedIds : filtered;
}

/** 选中集是否与当前一致（一致则跳过 dispatch，避免无谓重渲染） */
function sameSelection(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'set-document':
      return {
        past: [],
        present: action.document,
        future: [],
        selectedIds: action.selectedIds ?? []
      };

    case 'add-object':
      return pushHistory(
        state,
        { ...state.present, objects: [...state.present.objects, action.object] },
        [action.object.id]
      );

    // 批量新增（粘贴）：一次入历史，选中新对象
    case 'add-objects': {
      if (action.objects.length === 0) return state;
      return pushHistory(
        state,
        { ...state.present, objects: [...state.present.objects, ...action.objects] },
        action.objects.map((object) => object.id)
      );
    }

    // 复制选中并立即偏移（Ctrl+D）：从 present 取源，克隆新 id，选中新副本
    case 'duplicate-objects': {
      const idSet = new Set(action.ids);
      const sources = state.present.objects.filter((object) => idSet.has(object.id));
      if (sources.length === 0) return state;
      const clones = sources.map((object) => cloneObjectWithOffset(object, action.offset));
      return pushHistory(
        state,
        { ...state.present, objects: [...state.present.objects, ...clones] },
        clones.map((clone) => clone.id)
      );
    }

    // 从剪贴板粘贴（Ctrl+V）：源为快照（不在文档中），克隆新 id + 偏移，选中新副本
    case 'paste-objects': {
      if (action.objects.length === 0) return state;
      const clones = action.objects.map((object) => cloneObjectWithOffset(object, action.offset));
      return pushHistory(
        state,
        { ...state.present, objects: [...state.present.objects, ...clones] },
        clones.map((clone) => clone.id)
      );
    }

    case 'update-object': {
      let changed = false;
      const objects = state.present.objects.map((object) => {
        if (object.id !== action.id) return object;
        changed = true;
        return { ...object, ...action.patch } as DesignObject;
      });
      // 无实际变化（如未移动的 dragEnd）不入历史
      if (!changed) return state;
      return pushHistory(state, { ...state.present, objects });
    }

    // 批量更新（多选移动/变换/对齐/方向键）：一次入历史
    case 'update-objects': {
      if (action.patches.length === 0) return state;
      const patchMap = new Map(action.patches.map((entry) => [entry.id, entry.patch]));
      let changed = false;
      const objects = state.present.objects.map((object) => {
        const patch = patchMap.get(object.id);
        if (!patch) return object;
        changed = true;
        return { ...object, ...patch } as DesignObject;
      });
      if (!changed) return state;
      return pushHistory(state, { ...state.present, objects });
    }

    // 批量删除（单删亦走此路径，ids 长度 1）：一次入历史，选中集剔除被删 id
    case 'remove-objects': {
      const idSet = new Set(action.ids);
      const objects = state.present.objects.filter((object) => !idSet.has(object.id));
      if (objects.length === state.present.objects.length) return state;
      const selectedIds = state.selectedIds.filter((id) => !idSet.has(id));
      return pushHistory(state, { ...state.present, objects }, selectedIds);
    }

    case 'reorder': {
      const objects = reorderObject(state.present.objects, action.id, action.direction);
      if (objects === state.present.objects) return state;
      return pushHistory(state, { ...state.present, objects });
    }

    case 'reorder-many': {
      const objects = reorderObjects(state.present.objects, action.ids, action.direction);
      if (objects === state.present.objects) return state;
      return pushHistory(state, { ...state.present, objects });
    }

    case 'update-document':
      return pushHistory(state, { ...state.present, ...action.patch });

    case 'select':
      return sameSelection(state.selectedIds, action.ids)
        ? state
        : { ...state, selectedIds: action.ids };

    case 'toggle-select': {
      const has = state.selectedIds.includes(action.id);
      const selectedIds = has
        ? state.selectedIds.filter((id) => id !== action.id)
        : [...state.selectedIds, action.id];
      return { ...state, selectedIds };
    }

    case 'clear-select':
      return state.selectedIds.length === 0 ? state : { ...state, selectedIds: [] };

    case 'undo': {
      if (state.past.length === 0) return state;
      const present = state.past[state.past.length - 1];
      return {
        past: state.past.slice(0, -1),
        present,
        future: [state.present, ...state.future],
        selectedIds: reconcileSelection(present, state.selectedIds)
      };
    }

    case 'redo': {
      if (state.future.length === 0) return state;
      const [present, ...rest] = state.future;
      return {
        past: [...state.past, state.present],
        present,
        future: rest,
        selectedIds: reconcileSelection(present, state.selectedIds)
      };
    }

    default:
      return state;
  }
}

export function useEditorReducer(initialDocument: DesignDocument) {
  return useReducer(editorReducer, initialDocument, (document): EditorState => ({
    past: [],
    present: document,
    future: [],
    selectedIds: []
  }));
}
