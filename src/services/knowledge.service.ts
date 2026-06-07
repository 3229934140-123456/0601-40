import prisma from '../prisma';

interface SearchResult {
  id: string;
  title: string;
  content: string;
  source: string | null;
  relevance: number;
}

const calculateRelevance = (query: string, title: string, content: string): number => {
  const queryLower = query.toLowerCase();
  const titleLower = title.toLowerCase();
  const contentLower = content.toLowerCase();

  let score = 0;

  if (titleLower.includes(queryLower)) {
    score += 50;
  }

  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 0);
  for (const word of queryWords) {
    if (titleLower.includes(word)) {
      score += 20;
    }
    if (contentLower.includes(word)) {
      score += 10;
    }
  }

  const contentCount = (contentLower.match(new RegExp(queryLower, 'g')) || []).length;
  score += Math.min(contentCount * 5, 30);

  const titleCount = (titleLower.match(new RegExp(queryLower, 'g')) || []).length;
  score += titleCount * 10;

  const totalLength = title.length + content.length;
  if (totalLength > 0) {
    const density = (contentCount + titleCount) / totalLength;
    score += Math.min(density * 1000, 20);
  }

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

  const results: SearchResult[] = entries.map(entry => ({
    id: entry.id,
    title: entry.title,
    content: entry.content,
    source: entry.source,
    relevance: calculateRelevance(query, entry.title, entry.content),
  }));

  results.sort((a, b) => b.relevance - a.relevance);

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

  const context = searchResults.map((r, i) =>
    `[${i + 1}] ${r.title}\n${r.content.substring(0, 500)}\n来源：${r.source || '未知'}`
  ).join('\n\n');

  const topResult = searchResults[0];
  const relevantCount = searchResults.filter(r => r.relevance > 0.3).length;

  let answer = '';
  answer += `根据知识库中的信息，关于"${query}"的回答如下：\n\n`;
  answer += `**${topResult.title}**\n`;
  answer += `${topResult.content.substring(0, 300)}${topResult.content.length > 300 ? '...' : ''}\n\n`;

  if (relevantCount > 1) {
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
