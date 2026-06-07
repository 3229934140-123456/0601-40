import prisma from '../prisma';
import { fromJSON } from '../utils/json';

interface SearchResult {
  id: string;
  title: string;
  content: string;
  source: string | null;
  tags: string[] | null;
  version: number;
  relevance: number;
  summary: string;
  matchedFields: string[];
}

interface SearchOptions {
  topK?: number;
  tags?: string[];
  source?: string;
  startDate?: Date;
  endDate?: Date;
}

const escapeRegExp = (str: string): string => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const highlightMatch = (text: string, keywords: string[]): string => {
  const textLower = text.toLowerCase();
  let bestIndex = -1;
  let bestKeyword = '';

  for (const keyword of keywords) {
    const keywordLower = keyword.toLowerCase();
    const index = textLower.indexOf(keywordLower);
    if (index !== -1 && (bestIndex === -1 || index < bestIndex)) {
      bestIndex = index;
      bestKeyword = keyword;
    }
  }

  if (bestIndex === -1) return text.substring(0, 150) + (text.length > 150 ? '...' : '');

  const beforeIndex = Math.max(0, bestIndex - 30);
  const afterIndex = Math.min(text.length, bestIndex + bestKeyword.length + 30);

  let result = '';
  if (beforeIndex > 0) result += '...';
  result += text.substring(bestIndex, afterIndex);
  if (afterIndex < text.length) result += '...';

  return result;
};

const generateSummary = (title: string, content: string, source: string | null, keywords: string[]): string => {
  const contentLower = content.toLowerCase();
  const titleLower = title.toLowerCase();
  const sourceLower = source?.toLowerCase() || '';

  const hasContentMatch = keywords.some(kw => contentLower.includes(kw.toLowerCase()));
  const hasTitleMatch = keywords.some(kw => titleLower.includes(kw.toLowerCase()));
  const hasSourceMatch = keywords.some(kw => sourceLower.includes(kw.toLowerCase()));

  if (hasContentMatch) {
    return highlightMatch(content, keywords);
  }

  if (hasTitleMatch) {
    return highlightMatch(title, keywords) + (content.length > 0 ? ' - ' + content.substring(0, 100) + '...' : '');
  }

  if (hasSourceMatch && source) {
    return `来源匹配：${source}${content.length > 0 ? ' - ' + content.substring(0, 100) + '...' : ''}`;
  }

  return content.substring(0, 150) + (content.length > 150 ? '...' : '');
};

const getMatchedFields = (title: string, content: string, source: string | null, keywords: string[]): string[] => {
  const fields: string[] = [];
  const titleLower = title.toLowerCase();
  const contentLower = content.toLowerCase();
  const sourceLower = source?.toLowerCase() || '';

  if (keywords.some(kw => titleLower.includes(kw.toLowerCase()))) {
    fields.push('title');
  }
  if (keywords.some(kw => contentLower.includes(kw.toLowerCase()))) {
    fields.push('content');
  }
  if (source && keywords.some(kw => sourceLower.includes(kw.toLowerCase()))) {
    fields.push('source');
  }

  return fields;
};

const calculateRelevance = (
  title: string,
  content: string,
  source: string | null,
  keywords: string[]
): number => {
  if (keywords.length === 0) return 0;

  const titleLower = title.toLowerCase();
  const contentLower = content.toLowerCase();
  const sourceLower = source?.toLowerCase() || '';

  let hitCount = 0;
  let score = 0;

  for (const keyword of keywords) {
    const kw = keyword.toLowerCase();
    let keywordHit = false;

    if (titleLower.includes(kw)) {
      score += 50;
      keywordHit = true;
    }

    if (contentLower.includes(kw)) {
      score += 30;
      keywordHit = true;
    }

    if (sourceLower.includes(kw)) {
      score += 20;
      keywordHit = true;
    }

    if (keywordHit) {
      hitCount++;
    }
  }

  if (hitCount === 0) {
    return 0;
  }

  const titleHitCount = keywords.reduce((count, kw) => {
    const matches = titleLower.match(new RegExp(escapeRegExp(kw.toLowerCase()), 'gi'));
    return count + (matches ? matches.length : 0);
  }, 0);
  score += titleHitCount * 5;

  const contentHitCount = keywords.reduce((count, kw) => {
    const matches = contentLower.match(new RegExp(escapeRegExp(kw.toLowerCase()), 'gi'));
    return count + (matches ? matches.length : 0);
  }, 0);
  score += Math.min(contentHitCount * 2, 20);

  const hitRatio = hitCount / keywords.length;
  score = score * (0.5 + hitRatio * 0.5);

  return Math.min(score, 100) / 100;
};

const splitKeywords = (query: string): string[] => {
  return query.split(/\s+/).filter(w => w.length > 0);
};

export const searchKnowledgeEntries = async (
  knowledgeBaseId: string,
  query: string,
  options?: SearchOptions
): Promise<SearchResult[]> => {
  const topK = options?.topK ?? 5;

  const where: any = { knowledgeBaseId };

  if (options?.source) {
    where.source = options.source;
  }

  if (options?.startDate || options?.endDate) {
    where.updatedAt = {};
    if (options.startDate) {
      where.updatedAt.gte = options.startDate;
    }
    if (options.endDate) {
      where.updatedAt.lte = options.endDate;
    }
  }

  const entries = await prisma.knowledgeEntry.findMany({
    where,
    select: {
      id: true,
      title: true,
      content: true,
      source: true,
      tags: true,
      version: true,
    },
  });

  if (entries.length === 0) {
    return [];
  }

  const keywords = splitKeywords(query);

  let filteredEntries = entries;
  if (options?.tags && options.tags.length > 0) {
    filteredEntries = entries.filter(entry => {
      if (!entry.tags) return false;
      const entryTags = fromJSON<string[]>(entry.tags) || [];
      return options.tags!.every(tag => entryTags.includes(tag));
    });
  }

  if (filteredEntries.length === 0) {
    return [];
  }

  const results: SearchResult[] = filteredEntries
    .map(entry => {
      const relevance = calculateRelevance(entry.title, entry.content, entry.source, keywords);
      const matchedFields = getMatchedFields(entry.title, entry.content, entry.source, keywords);
      const summary = generateSummary(entry.title, entry.content, entry.source, keywords);
      const tags = fromJSON<string[]>(entry.tags) || null;

      return {
        id: entry.id,
        title: entry.title,
        content: entry.content,
        source: entry.source,
        tags,
        version: entry.version,
        relevance,
        summary,
        matchedFields,
      };
    })
    .filter(r => r.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance);

  return results.slice(0, topK);
};

export const generateAnswer = async (
  query: string,
  searchResults: SearchResult[]
): Promise<{ answer: string; citations: SearchResult[] }> => {
  if (searchResults.length === 0) {
    return {
      answer: `抱歉，在知识库中没有找到与"${query}"相关的内容。请尝试使用其他关键词查询，或联系管理员添加相关知识。`,
      citations: [],
    };
  }

  const topResult = searchResults[0];
  
  let answer = '';
  answer += `根据知识库中的信息，关于"${query}"的回答如下：\n\n`;
  answer += `**${topResult.title}**\n`;
  answer += `${topResult.content.substring(0, 300)}${topResult.content.length > 300 ? '...' : ''}\n\n`;

  if (searchResults.length > 1) {
    answer += `\n**相关内容：**\n`;
    for (let i = 1; i < Math.min(searchResults.length, 5); i++) {
      answer += `${i + 1}. ${searchResults[i].title}（相关度：${Math.round(searchResults[i].relevance * 100)}%）\n`;
    }
  }

  answer += `\n\n*以上回答来自知识库中的 ${searchResults.length} 条相关内容，请参考引用来源获取完整信息。*`;

  return {
    answer,
    citations: searchResults,
  };
};
