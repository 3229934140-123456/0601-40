import prisma from '../prisma';

interface SensitiveWord {
  id: string;
  word: string;
  category: string;
  severity: string;
  replacement: string | null;
  enabled: boolean;
}

interface MatchResult {
  word: string;
  category: string;
  severity: string;
  position: number;
  replacement?: string | null;
}

interface CheckResult {
  passed: boolean;
  matchedWords: MatchResult[];
  censoredText?: string;
}

let wordCache: SensitiveWord[] = [];
let cacheTime = 0;
const CACHE_TTL = 5000;

const loadWords = async (): Promise<SensitiveWord[]> => {
  const now = Date.now();
  if (now - cacheTime < CACHE_TTL && wordCache.length > 0) {
    return wordCache;
  }

  const words = await prisma.sensitiveWord.findMany({
    where: { enabled: true },
    select: {
      id: true,
      word: true,
      category: true,
      severity: true,
      replacement: true,
      enabled: true,
    },
  });

  wordCache = words as SensitiveWord[];
  cacheTime = now;
  return wordCache;
};

export const invalidateWordCache = () => {
  cacheTime = 0;
  wordCache = [];
};

export const checkSensitive = async (
  text: string,
  options?: {
    categories?: string[];
    censor?: boolean;
  }
): Promise<CheckResult> => {
  const words = await loadWords();

  let filteredWords = words;
  if (options?.categories && options.categories.length > 0) {
    filteredWords = words.filter(w => options!.categories!.includes(w.category));
  }

  const matchedWords: MatchResult[] = [];

  for (const word of filteredWords) {
    let position = text.indexOf(word.word);
    while (position !== -1) {
      matchedWords.push({
        word: word.word,
        category: word.category,
        severity: word.severity,
        position,
        replacement: word.replacement,
      });
      position = text.indexOf(word.word, position + 1);
    }
  }

  matchedWords.sort((a, b) => a.position - b.position);

  let censoredText: string | undefined;
  if (options?.censor && matchedWords.length > 0) {
    let result = text;
    const uniqueWords = [...new Set(matchedWords.map(m => m.word))];
    
    for (const word of uniqueWords) {
      const wordInfo = filteredWords.find(w => w.word === word);
      const replacement = wordInfo?.replacement || '*'.repeat(word.length);
      result = result.split(word).join(replacement);
    }
    censoredText = result;
  }

  return {
    passed: matchedWords.length === 0,
    matchedWords,
    censoredText,
  };
};
