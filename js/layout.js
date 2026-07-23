// 計算木(AST)や答えの値を、ドット絵の2Dレイアウト(箱)にして描く。
// 箱 = {w, h, mid, draw(ctx,x,y,color)}。mid=演算子の軸になる行(縦位置合わせに使う)
(function (global) {
	"use strict";

	var F = global.DotFont;

	function textBox(s) {
		return {
			w: F.textWidth(s.length),
			h: F.GLYPH_H,
			mid: 3,
			draw: function (ctx, x, y, color) { F.drawText(ctx, s, x, y, color); }
		};
	}

	// 欠けている場所(入力途中)の点線の箱
	function placeholderBox() {
		return {
			w: 5, h: 7, mid: 3,
			draw: function (ctx, x, y, color) {
				ctx.fillStyle = color;
				for (var i = 0; i < 5; i += 2) {
					ctx.fillRect(x + i, y, 1, 1);
					ctx.fillRect(x + i, y + 6, 1, 1);
				}
				for (var j = 2; j < 6; j += 2) {
					ctx.fillRect(x, y + j, 1, 1);
					ctx.fillRect(x + 4, y + j, 1, 1);
				}
			}
		};
	}

	function hbox(items, gap) {
		if (gap === undefined) gap = 1;
		var mid = 0, below = 0, w = 0;
		for (var i = 0; i < items.length; i++) {
			mid = Math.max(mid, items[i].mid);
			below = Math.max(below, items[i].h - items[i].mid);
			w += items[i].w + (i > 0 ? gap : 0);
		}
		return {
			w: w, h: mid + below, mid: mid,
			draw: function (ctx, x, y, color) {
				var cx = x;
				for (var i = 0; i < items.length; i++) {
					items[i].draw(ctx, cx, y + (mid - items[i].mid), color);
					cx += items[i].w + gap;
				}
			}
		};
	}

	// 分数: 分子/横棒/分母 の縦積み。横棒は広い方+左右1ドット
	function fracBox(num, den) {
		var w = Math.max(num.w, den.w) + 2;
		var h = num.h + den.h + 3;
		var mid = num.h + 1; // 横棒の行
		return {
			w: w, h: h, mid: mid,
			draw: function (ctx, x, y, color) {
				num.draw(ctx, x + Math.floor((w - num.w) / 2), y, color);
				ctx.fillStyle = color;
				ctx.fillRect(x, y + num.h + 1, w, 1);
				den.draw(ctx, x + Math.floor((w - den.w) / 2), y + num.h + 3, color);
			}
		};
	}

	// √: 中身の上に線を伸ばす(vinculum)。左はレ点
	function sqrtBox(arg) {
		var w = arg.w + 6;
		var h = arg.h + 2;
		return {
			w: w, h: h, mid: arg.mid + 2,
			draw: function (ctx, x, y, color) {
				ctx.fillStyle = color;
				ctx.fillRect(x + 3, y, w - 3, 1);          // 上線
				ctx.fillRect(x + 3, y, 1, h);              // 縦線
				ctx.fillRect(x + 2, y + h - 2, 1, 1);      // レ点
				ctx.fillRect(x + 1, y + h - 3, 1, 1);
				arg.draw(ctx, x + 5, y + 2, color);
			}
		};
	}

	// かっこ: 中身の高さに合わせて伸びる。
	// 幅=中身+8(左右とも 空き1+弧2+空き1)。中身の最終列と閉じ弧が重ならないよう左右対称に取る
	function parenBox(inner) {
		var h = Math.max(inner.h, 7);
		var w = inner.w + 8;
		return {
			w: w, h: h, mid: inner.mid,
			draw: function (ctx, x, y, color) {
				ctx.fillStyle = color;
				ctx.fillRect(x + 1, y + 1, 1, h - 2);          // 左弧
				ctx.fillRect(x + 2, y, 1, 1);
				ctx.fillRect(x + 2, y + h - 1, 1, 1);
				ctx.fillRect(x + w - 2, y + 1, 1, h - 2);      // 右弧
				ctx.fillRect(x + w - 3, y, 1, 1);
				ctx.fillRect(x + w - 3, y + h - 1, 1, 1);
				inner.draw(ctx, x + 4, y + (inner.h < h ? Math.floor((h - inner.h) / 2) : 0), color);
			}
		};
	}

	// 入力カーソル(縦棒1×7)
	function caretBox() {
		return {
			w: 1, h: 7, mid: 3,
			draw: function (ctx, x, y, color) {
				ctx.fillStyle = color;
				ctx.fillRect(x, y, 1, 7);
			}
		};
	}

	// AST → 箱
	function astBox(node) {
		switch (node.t) {
			case "num": return textBox(node.s);
			case "empty": return placeholderBox();
			case "caret": return caretBox();
			case "caretAfter": return hbox([astBox(node.x), caretBox()]);
			case "group": return parenBox(astBox(node.x));
			case "neg": return hbox([textBox("-"), astBox(node.x)]);
			case "sqrt": return sqrtBox(astBox(node.x));
			case "frac": return fracBox(astBox(node.l), astBox(node.r));
			case "add": return hbox([astBox(node.l), textBox("+"), astBox(node.r)]);
			case "sub": return hbox([astBox(node.l), textBox("-"), astBox(node.r)]);
			case "divop": return hbox([astBox(node.l), textBox("/"), astBox(node.r)]);
			case "mul":
				if (node.implicit) return hbox([astBox(node.l), astBox(node.r)]);
				return hbox([astBox(node.l), textBox("*"), astBox(node.r)]);
		}
		return placeholderBox();
	}

	// ---- 答え(Exactの値)→ 箱 ----

	function bigDigits(x) { return String(x < 0n ? -x : x).length; }

	// 有理数を箱に(整数なら文字、それ以外は縦積み分数。大きすぎたらnull=小数へ)
	function ratBox(v, allowSign) {
		var neg = v.n < 0n;
		var n = neg ? -v.n : v.n;
		if (v.d === 1n) {
			if (bigDigits(n) > 12) return null;
			return textBox((neg && allowSign ? "-" : "") + String(n));
		}
		if (bigDigits(n) > 10 || bigDigits(v.d) > 10) return null;
		var f = fracBox(textBox(String(n)), textBox(String(v.d)));
		return neg && allowSign ? hbox([textBox("-"), f]) : f;
	}

	// 値 → 箱。approx=trueなら常に小数。表せなければ小数、それも無理ならnull(=ERR)
	function valueBox(v, approx) {
		var E = global.Exact;
		if (!approx) {
			if (v.k === "rat") {
				var rb = ratBox(v, true);
				if (rb) return rb;
			} else if (v.k === "quad") {
				var items = [];
				var a = v.a, b = v.b;
				var bNeg = b.n < 0n;
				var bAbs = bNeg ? E.rat(-b.n, b.d) : b;
				var aZero = a.n === 0n;
				var ok = true;
				if (!aZero) {
					var ab = ratBox(a, true);
					if (ab) items.push(ab); else ok = false;
				}
				if (ok) {
					if (aZero) { if (bNeg) items.push(textBox("-")); }
					else items.push(textBox(bNeg ? "-" : "+"));
					var one = bAbs.n === 1n && bAbs.d === 1n;
					if (!one) {
						var bb = ratBox(bAbs, false);
						if (bb) items.push(bb); else ok = false;
					}
					if (bigDigits(v.r) > 10) ok = false;
					if (ok) {
						items.push(sqrtBox(textBox(String(v.r))));
						return hbox(items);
					}
				}
			}
		}
		var s = E.formatDec(E.toNumber(v));
		return s === null ? null : textBox(s);
	}

	global.DotLayout = {
		textBox: textBox,
		astBox: astBox,
		valueBox: valueBox
	};
})(typeof window !== "undefined" ? window : globalThis);
