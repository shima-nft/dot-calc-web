// トークン列 → 計算木(AST) → 評価。
// lenient=true は表示用(入力途中でも欠けた場所を empty として木を作る)、
// false は=用(欠けがあれば構文エラー)。
// 優先順位: かっこ > √(直後の1項) > 分数(縦積み) > ×÷(暗黙の掛け算含む) > +−
(function (global) {
	"use strict";

	function parse(tokens, lenient) {
		var pos = 0;

		function peek() { return pos < tokens.length ? tokens[pos] : null; }

		function fail() {
			var e = new Error("syntax");
			e.calcError = true;
			throw e;
		}

		function emptyNode() {
			if (!lenient) fail();
			return { t: "empty" };
		}

		// primary: 数 | (式) | カーソル | 欠け
		function primary() {
			var tk = peek();
			if (tk === null) return emptyNode();
			if (tk.t === "num") { pos++; return { t: "num", s: tk.s }; }
			if (tk.t === "caret") { pos++; return { t: "caret" }; } // 表示専用(=の評価には混ぜない)
			if (tk.t === "lp") {
				pos++;
				var inner = expr();
				if (peek() !== null && peek().t === "rp") pos++;
				else if (!lenient) fail();
				return { t: "group", x: inner };
			}
			return emptyNode();
		}

		// 直後にカーソルが付いていれば「アトム+カーソル」として括る
		// (分子の末尾などでカーソルが分数の中に正しく描かれるようにするため)
		function withCaret(node) {
			var tk = peek();
			if (tk !== null && tk.t === "caret") {
				pos++;
				return { t: "caretAfter", x: node };
			}
			return node;
		}

		// unary: −や√の前置
		function unary() {
			var tk = peek();
			if (tk !== null && tk.t === "op" && tk.v === "-") {
				pos++;
				return withCaret({ t: "neg", x: unary() });
			}
			if (tk !== null && tk.t === "sqrt") {
				pos++;
				return withCaret({ t: "sqrt", x: unary() });
			}
			return withCaret(primary());
		}

		// 分数(⁄)は×÷より強い。左結合: 1⁄2⁄3 = (1/2)/3
		function fracChain() {
			var left = unary();
			while (peek() !== null && peek().t === "frac") {
				pos++;
				left = { t: "frac", l: left, r: unary() };
			}
			return left;
		}

		// ×÷と暗黙の掛け算(2√3・2(1+2)など)
		function term() {
			var left = fracChain();
			for (;;) {
				var tk = peek();
				if (tk !== null && tk.t === "op" && (tk.v === "*" || tk.v === "/")) {
					pos++;
					left = { t: tk.v === "*" ? "mul" : "divop", l: left, r: fracChain() };
				} else if (tk !== null && (tk.t === "num" || tk.t === "lp" || tk.t === "sqrt")) {
					// 演算子なしで数・かっこ・√が続く=暗黙の掛け算
					left = { t: "mul", l: left, r: fracChain(), implicit: true };
				} else {
					return left;
				}
			}
		}

		function expr() {
			var left = term();
			for (;;) {
				var tk = peek();
				if (tk !== null && tk.t === "op" && (tk.v === "+" || tk.v === "-")) {
					pos++;
					left = { t: tk.v === "+" ? "add" : "sub", l: left, r: term() };
				} else {
					return left;
				}
			}
		}

		var root = tokens.length === 0 ? { t: "empty" } : expr();
		if (pos < tokens.length) {
			if (!lenient) fail();
			// 表示用: 解釈できなかった残りも欠けとして左から繋ぐ(通常来ないが保険)
			while (pos < tokens.length) { pos++; }
		}
		return root;
	}

	function evalNode(node) {
		var E = global.Exact || require("./exact.js");
		switch (node.t) {
			case "num": return E.ratFromString(node.s);
			case "group": return evalNode(node.x);
			case "neg": return E.neg(evalNode(node.x));
			case "sqrt": return E.sqrt(evalNode(node.x));
			case "add": return E.add(evalNode(node.l), evalNode(node.r));
			case "sub": return E.sub(evalNode(node.l), evalNode(node.r));
			case "mul": return E.mul(evalNode(node.l), evalNode(node.r));
			case "divop": return E.div(evalNode(node.l), evalNode(node.r));
			case "frac": return E.div(evalNode(node.l), evalNode(node.r));
		}
		var e = new Error("syntax");
		e.calcError = true;
		throw e;
	}

	// 式に小数点入力が含まれるか(含まれるなら答えの既定表示は小数にする)
	function hasDecimal(tokens) {
		for (var i = 0; i < tokens.length; i++) {
			if (tokens[i].t === "num" && tokens[i].s.indexOf(".") !== -1) return true;
		}
		return false;
	}

	// ()ボタンの自動判別: 未クローズの ( があり、直前が完結した被演算子なら ")"、それ以外は "("
	function smartParen(tokens) {
		var open = 0;
		for (var i = 0; i < tokens.length; i++) {
			if (tokens[i].t === "lp") open++;
			else if (tokens[i].t === "rp" && open > 0) open--;
		}
		var last = tokens.length ? tokens[tokens.length - 1] : null;
		if (open > 0 && last !== null && (last.t === "num" || last.t === "rp")) return "rp";
		return "lp";
	}

	// =の時点で閉じ忘れの ) を自動で閉じる
	function autoClose(tokens) {
		var open = 0;
		for (var i = 0; i < tokens.length; i++) {
			if (tokens[i].t === "lp") open++;
			else if (tokens[i].t === "rp" && open > 0) open--;
		}
		var out = tokens.slice();
		while (open-- > 0) out.push({ t: "rp" });
		return out;
	}

	global.Parser = {
		parse: parse,
		evalNode: evalNode,
		hasDecimal: hasDecimal,
		autoClose: autoClose,
		smartParen: smartParen
	};
	if (typeof module !== "undefined" && module.exports) module.exports = global.Parser;
})(typeof window !== "undefined" ? window : globalThis);
