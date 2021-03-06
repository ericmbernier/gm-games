/**
 * Based on https://github.com/Aterbonus/AterCalculator
 *
 * Copyright (c) 2016 Gustavo Alfredo Marín Sáez
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import { DEFAULT_POINTS_FORMULA } from "../../../common";
import { g } from "../../util";

const SYMBOLS = ["W", "L", "T", "OTL"] as const;
type PointsFormulaSymbol = typeof SYMBOLS[number];

const BINARY_MINUS = "-";
const UNARY_MINUS = "#";

const regexEncode = (string: string) => {
	// eslint-disable-next-line no-useless-escape
	return string.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
};

const regexSort = (a: string, b: string) => {
	return a.length - b.length;
};

const operators: Record<
	string,
	{
		operands: number;
		precedence: number;
		associativity: "l" | "r";
		func: (a: number, b: number) => number;
	}
> = {
	"+": {
		operands: 2,
		precedence: 1,
		associativity: "l",
		func: (a, b) => a + b,
	},
	"-": {
		operands: 2,
		precedence: 1,
		associativity: "l",
		func: (a, b) => a - b,
	},
	"*": {
		operands: 2,
		precedence: 2,
		associativity: "l",
		func: (a, b) => a * b,
	},
	"/": {
		operands: 2,
		precedence: 2,
		associativity: "l",
		func: (a, b) => a / b,
	},
	"^": {
		operands: 2,
		precedence: 4,
		associativity: "r",
		func: (a, b) => Math.pow(a, b),
	},
	"#": {
		operands: 1,
		precedence: 3,
		associativity: "r",
		func: a => -a,
	},
};

const operatorsString = Object.keys(operators)
	.map(regexEncode)
	.sort(regexSort)
	.join("|");

const parseUnaryMinus = (string: string) => {
	return string
		.replace(/\s/g, "")
		.replace(
			new RegExp(regexEncode(BINARY_MINUS), "g"),
			(match, offset, string) => {
				if (offset === 0) {
					return UNARY_MINUS;
				}
				const prevChar = string[offset - 1];
				return !!operators[prevChar] || prevChar === "("
					? UNARY_MINUS
					: BINARY_MINUS;
			},
		);
};

const shuntingYard = (string: string) => {
	const tokens = string.match(
		new RegExp(
			"\\d+(?:[\\.]\\d+)?(?:[eE]\\d+)?|[()]" + `|${operatorsString}|[a-zA-Z]+`,
			"g",
		),
	);

	let aux;
	const stack: string[] = [];
	const output: string[] = [];

	if (tokens) {
		for (const token of tokens) {
			if (token === ",") {
				while (stack.length > 0 && stack[stack.length - 1] !== "(") {
					output.push(stack.pop() as string);
				}
				if (stack.length === 0) {
					throw new Error(
						"A separator (,) was misplaced or parentheses were mismatched",
					);
				}
			} else if (operators[token]) {
				const operator = operators[token];
				while (
					typeof operators[stack[stack.length - 1]] !== "undefined" &&
					((operator.associativity === "l" &&
						operator.precedence <=
							operators[stack[stack.length - 1]].precedence) ||
						(operator.associativity === "r" &&
							operator.precedence <
								operators[stack[stack.length - 1]].precedence))
				) {
					output.push(stack.pop() as string);
				}
				stack.push(token);
			} else if (token === "(") {
				stack.push(token);
			} else if (token === ")") {
				while ((aux = stack.pop()) !== "(" && typeof aux !== "undefined") {
					output.push(aux);
				}
				if (aux !== "(") {
					throw new Error("Mismatched parentheses");
				}
			} else {
				output.push(token);
			}
		}

		while (typeof (aux = stack.pop()) !== "undefined") {
			if ("(" === aux || ")" === aux) {
				throw new Error("Mismatched parentheses");
			}
			output.push(aux);
		}
	}

	return output;
};

const partiallyEvaluate = (tokens: string[]) => {
	const processed: (string | number)[] = [];

	for (const token of tokens) {
		if (SYMBOLS.includes(token as any)) {
			processed.push(token);
		} else if (operators[token] !== undefined) {
			processed.push(token);
		} else {
			const float = parseFloat(token);
			if (Number.isNaN(float)) {
				throw new Error(`Invalid variable "${token}"`);
			}
			processed.push(float);
		}
	}

	return processed;
};

export class PointsFormulaEvaluator {
	tokens: (string | number)[];

	constructor(equation: string) {
		this.tokens = partiallyEvaluate(shuntingYard(parseUnaryMinus(equation)));

		// Run it once, just to confirm it works up front
		this.evaluate({
			W: 1,
			L: 2,
			OTL: 3,
			T: 4,
		});
	}

	evaluate(symbols: Record<PointsFormulaSymbol, number>) {
		const stack: number[] = [];

		for (const token of this.tokens) {
			const operator = operators[token];
			if (operator !== undefined) {
				if (stack.length < operator.operands) {
					throw new Error("Insufficient values in the expression");
				}
				const args = stack.splice(-operator.operands, operator.operands);
				stack.push((operator.func as any)(...args));
			} else if (typeof token === "number") {
				stack.push(token);
			} else {
				stack.push((symbols as any)[token]);
			}
		}
		if (stack.length !== 1) {
			throw new Error("Too many values in the expression");
		}

		return stack.pop() as number;
	}
}

const formulaCache: Record<string, PointsFormulaEvaluator> = {};

const evaluatePointsFormula = (
	data: {
		won: number;
		lost: number;
		otl: number;
		tied: number;
	},
	{
		formula,
		season = g.get("season"),
	}: {
		formula?: string;
		season?: number;
	} = {},
) => {
	let pointsFormula = formula ?? g.get("pointsFormula", season);
	if (pointsFormula === "") {
		// Even if no formula defined (sort by win%), use the default, so points can still be displayed
		pointsFormula = DEFAULT_POINTS_FORMULA;
	}

	if (!formulaCache[pointsFormula]) {
		formulaCache[pointsFormula] = new PointsFormulaEvaluator(pointsFormula);
	}
	return formulaCache[pointsFormula].evaluate({
		W: data.won,
		L: data.lost,
		OTL: data.otl,
		T: data.tied,
	});
};

export default evaluatePointsFormula;
