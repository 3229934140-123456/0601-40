export const toJSON = (value: any): string | null => {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
};

export const fromJSON = <T = any>(value: string | null | undefined): T | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

export const safeParseJSON = (str: string | null | undefined): any => {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
};
