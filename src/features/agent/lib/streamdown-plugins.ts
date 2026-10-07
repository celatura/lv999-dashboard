import { code } from '@streamdown/code';
import { cjk } from '@streamdown/cjk';

/**
 * Streamdown 插件集：模块级创建一次，保证引用稳定。
 *
 * Streamdown 的 React.memo 自定义比较按引用比较 plugins（e.plugins === t.plugins），
 * 内联 `plugins={{ code, cjk }}` 每次渲染都是新引用、会使该比较恒为 false。提为模块级
 * 常量后引用恒定，符合官方 features.md「Plugin arrays: Created once at module level」。
 * 聊天消息与资产预览共用同一套插件，故在此单例化，两处引用同一对象。
 */
export const STREAMDOWN_PLUGINS = { code, cjk };
