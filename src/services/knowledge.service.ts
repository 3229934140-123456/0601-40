import prisma from '../prisma';

interface SearchResult {
  id: string;
  title: string;
  content: string;
  source: string | null;
  relevance: number;
  summary: string;
  matchedFields: string[];
}

const escapeRegExp = (str: string): string => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const highlightMatch = (text: string, query: string): string => {
  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();
  const index = textLower.indexOf(queryLower);
  
  if (index === -1) return text;
  
  const beforeIndex = Math.max(0, index - 30);
  const afterIndex = Math.min(text.length, index + query.length + 30);
  
  let result = '';
  if (beforeIndex > 0) result += '...';
  result += text.substring(beforeIndex, afterIndex);
  if (afterIndex < text.length) result += '...';
  
  return result;
};

const generateSummary = (title: string, content: string, source: string | null, query: string): string => {
  const queryLower = query.toLowerCase();
  const titleLower = title.toLowerCase();
  const contentLower = content.toLowerCase();
  const sourceLower = source?.toLowerCase() || '';

  if (contentLower.includes(queryLower)) {
    return highlightMatch(content, query);
  }

  if (titleLower.includes(queryLower)) {
    return highlightMatch(title, query) + (content.length > 0 ? ' - ' + content.substring(0, 100) + '...' : '');
  }

  if (sourceLower.includes(queryLower)) {
    return `来源匹配：${source}${content.length > 0 ? ' - ' + content.substring(0, 100) + '...' : ''}`;
  }

  return content.substring(0, 150) + (content.length > 150 ? '...' : '');
};

const getMatchedFields = (title: string, content: string, source: string | null, query: string): string[] => {
  const queryLower = query.toLowerCase();
  const fields: string[] = [];

  if (title.toLowerCase().includes(queryLower)) {
    fields.push('title');
  }
  if (content.toLowerCase().includes(queryLower)) {
    fields.push('content');
  }
  if (source && source.toLowerCase().includes(queryLower)) {
    fields.push('source');
  }

  return fields;
};

const calculateRelevance = (query: string, title: string, content: string, source: string | null): number => {
  const queryLower = query.toLowerCase();
  const titleLower = title.toLowerCase();
  const contentLower = content.toLowerCase();
  const sourceLower = source?.toLowerCase() || '';

  let score = 0;
  let hasMatch = false;

  if (titleLower.includes(queryLower)) {
    score += 50;
    hasMatch = true;
  }

  if (contentLower.includes(queryLower)) {
    score += 30;
    hasMatch = true;
  }

  if (sourceLower.includes(queryLower)) {
    score += 20;
    hasMatch = true;
  }

  if (!hasMatch) {
    return 0;
  }

  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 1);
  for (const word of queryWords) {
    if (titleLower.includes(word)) score += 10;
    if (contentLower.includes(word)) score += 5;
    if (sourceLower.includes(word)) score += 5;
  }

  const titleCount = (titleLower.match(new RegExp(escapeRegExp(queryLower), 'gi')) || []).length;
  score += titleCount * 5;

  const contentCount = (contentLower.match(new RegExp(escapeRegExp(queryLower), 'gi')) || []).length;
  score += Math.min(contentCount * 2, 20);

  return Math.min(score, 100) / 100;
};

export const searchKnowledgeEntries = async (
  knowledgeBaseId: string,
  query: string,
  topK: number = 5
): Promise<SearchResult[]> => {
  const entries = await prisma.knowledgeEntry.findMany({
    where: { knowledgeBaseId },
    select: {
      id: true,
      title: true,
      content: true,
      source: true,
    },
  });

  if (entries.length === 0) {
    return [];
  }

  const results: SearchResult[] = entries
    .map(entry => {
      const relevance = calculateRelevance(query, entry.title, entry.content, entry.source);
      const matchedFields = getMatchedFields(entry.title, entry.content, entry.source, query);
      const summary = generateSummary(entry.title, entry.content, entry.source, query);
      
      return {
        id: entry.id,
        title: entry.title,
        content: entry.content,
        source: entry.source,
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
