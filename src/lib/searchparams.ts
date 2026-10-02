import {
  createSearchParamsCache,
  createSerializer,
  parseAsBoolean,
  parseAsInteger,
  parseAsString
} from 'nuqs/server';

export const searchParams = {
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(10),
  title: parseAsString,
  kind: parseAsString,
  favorite: parseAsBoolean,
  /** 知识库文档状态筛选（逗号分隔：processing/ready/failed） */
  status: parseAsString,
  /** 知识库文档来源筛选（逗号分隔：manual/asset） */
  source: parseAsString,
  /** 管理端用户列表搜索（邮箱 / 名称 / userId，ilike 匹配 user 表） */
  query: parseAsString,
  sort: parseAsString
  // advanced filter
  // filters: getFiltersStateParser().withDefault([]),
  // joinOperator: parseAsStringEnum(['and', 'or']).withDefault('and')
};

export const searchParamsCache = createSearchParamsCache(searchParams);
export const serialize = createSerializer(searchParams);
