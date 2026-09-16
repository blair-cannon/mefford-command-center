export type EstimateFormulaResult =
  | { ok: true; value: number; expression: string; hasFormula: boolean }
  | { ok: false; error: string };

const MAX_FORMULA_LENGTH = 120;
const MAX_ABSOLUTE_RESULT = 1_000_000_000_000;

export function evaluateEstimateFormula(input: unknown): EstimateFormulaResult {
  const original = String(input ?? "").trim();
  if (!original) return { ok: false, error: "Enter a number or formula." };
  if (original.length > MAX_FORMULA_LENGTH) return { ok: false, error: "Formula is too long." };

  const prepared = original
    .replace(/^=/, "")
    .replace(/[,$]/g, "")
    .replace(/[×xX]/g, "*")
    .replace(/[÷]/g, "/")
    .replace(/[−–—]/g, "-")
    .trim();
  if (!prepared) return { ok: false, error: "Enter a number or formula." };

  let index = 0;
  const skipSpaces = () => {
    while (/\s/.test(prepared[index] || "")) index += 1;
  };

  const parseExpression = (): number => {
    let value = parseTerm();
    while (true) {
      skipSpaces();
      const operator = prepared[index];
      if (operator !== "+" && operator !== "-") break;
      index += 1;
      const right = parseTerm();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  };

  const parseTerm = (): number => {
    let value = parseUnary();
    while (true) {
      skipSpaces();
      const operator = prepared[index];
      if (operator !== "*" && operator !== "/") break;
      index += 1;
      const right = parseUnary();
      if (operator === "/" && right === 0) throw new Error("Formula cannot divide by zero.");
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  };

  const parseUnary = (): number => {
    skipSpaces();
    if (prepared[index] === "+") {
      index += 1;
      return parseUnary();
    }
    if (prepared[index] === "-") {
      index += 1;
      return -parseUnary();
    }
    return parsePrimary();
  };

  const parsePrimary = (): number => {
    skipSpaces();
    let value: number;
    if (prepared[index] === "(") {
      index += 1;
      value = parseExpression();
      skipSpaces();
      if (prepared[index] !== ")") throw new Error("Close every parenthesis in the formula.");
      index += 1;
    } else {
      const match = prepared.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
      if (!match) throw new Error("Use numbers and +, -, ×, ÷, or parentheses.");
      value = Number(match[0]);
      index += match[0].length;
    }
    skipSpaces();
    while (prepared[index] === "%") {
      value /= 100;
      index += 1;
      skipSpaces();
    }
    return value;
  };

  try {
    const value = parseExpression();
    skipSpaces();
    if (index !== prepared.length) throw new Error("Use numbers and +, -, ×, ÷, or parentheses.");
    if (!Number.isFinite(value) || Math.abs(value) > MAX_ABSOLUTE_RESULT) {
      throw new Error("Formula result is outside the supported range.");
    }
    const hasFormula = /[+*/()%]/.test(prepared) || /-(?!^\s*\d+(?:\.\d+)?\s*$)/.test(prepared);
    return {
      ok: true,
      value,
      expression: hasFormula ? original.slice(0, MAX_FORMULA_LENGTH) : "",
      hasFormula,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Formula could not be calculated." };
  }
}

