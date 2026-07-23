// 正確計算エンジン: 分数はBigIntの有理数、√は a+b√r の形まで正確に保持。
// 表せない組み合わせ(異なる√同士の加算など)は小数(dec)に自然に落とす。
(function (global) {
	"use strict";

	function err(msg) {
		var e = new Error(msg);
		e.calcError = true;
		throw e;
	}

	function bAbs(x) { return x < 0n ? -x : x; }

	function gcd(a, b) {
		a = bAbs(a); b = bAbs(b);
		while (b) { var t = a % b; a = b; b = t; }
		return a;
	}

	// ---- 有理数 n/d(d>0・既約) ----
	function rat(n, d) {
		if (d === 0n) err("div0");
		if (d < 0n) { n = -n; d = -d; }
		var g = gcd(n, d);
		if (g > 1n) { n /= g; d /= g; }
		return { k: "rat", n: n, d: d };
	}

	function ratFromString(s) {
		// "12.5" → 125/10 のように正確に取り込む(浮動小数を経由しない)
		var neg = s.charAt(0) === "-";
		if (neg) s = s.slice(1);
		var dot = s.indexOf(".");
		var digits = dot === -1 ? s : s.slice(0, dot) + s.slice(dot + 1);
		if (digits === "") digits = "0";
		var scale = dot === -1 ? 0 : s.length - dot - 1;
		var n = BigInt(digits);
		var d = 10n ** BigInt(scale);
		return rat(neg ? -n : n, d);
	}

	function isZero(v) { return v.k === "rat" && v.n === 0n; }

	// ---- a + b√r(a,bは有理数・r>1)。b=0やr=1は rat に正規化 ----
	function quad(a, b, r) {
		if (b.n === 0n) return a;
		if (r === 1n) return radd(a, b);
		return { k: "quad", a: a, b: b, r: r };
	}

	function dec(x) {
		if (!isFinite(x)) err("overflow");
		return { k: "dec", x: x };
	}

	// ---- 有理数どうしの四則 ----
	function radd(p, q) { return rat(p.n * q.d + q.n * p.d, p.d * q.d); }
	function rsub(p, q) { return rat(p.n * q.d - q.n * p.d, p.d * q.d); }
	function rmul(p, q) { return rat(p.n * q.n, p.d * q.d); }
	function rdiv(p, q) {
		if (q.n === 0n) err("div0");
		return rat(p.n * q.d, p.d * q.n);
	}

	function toNumber(v) {
		if (v.k === "dec") return v.x;
		if (v.k === "rat") return Number(v.n) / Number(v.d);
		return Number(v.a.n) / Number(v.a.d) + (Number(v.b.n) / Number(v.b.d)) * Math.sqrt(Number(v.r));
	}

	// quad の a/b を取り出す(rat は b=0 の quad とみなす)
	function qa(v) { return v.k === "quad" ? v.a : v; }
	function qb(v) { return v.k === "quad" ? v.b : rat(0n, 1n); }
	function qr(v) { return v.k === "quad" ? v.r : null; }

	// 2値の√の種類を合わせられるか(null=有理数はどちらにも合う)
	function commonRoot(x, y) {
		var rx = qr(x), ry = qr(y);
		if (rx === null) return ry;
		if (ry === null) return rx;
		if (rx === ry) return rx;
		return undefined; // 混ぜられない → dec へ
	}

	function add(x, y) {
		if (x.k === "dec" || y.k === "dec") return dec(toNumber(x) + toNumber(y));
		var r = commonRoot(x, y);
		if (r === undefined) return dec(toNumber(x) + toNumber(y));
		if (r === null) return radd(x, y);
		return quad(radd(qa(x), qa(y)), radd(qb(x), qb(y)), r);
	}

	function sub(x, y) {
		if (x.k === "dec" || y.k === "dec") return dec(toNumber(x) - toNumber(y));
		var r = commonRoot(x, y);
		if (r === undefined) return dec(toNumber(x) - toNumber(y));
		if (r === null) return rsub(x, y);
		return quad(rsub(qa(x), qa(y)), rsub(qb(x), qb(y)), r);
	}

	function mul(x, y) {
		if (x.k === "dec" || y.k === "dec") return dec(toNumber(x) * toNumber(y));
		var r = commonRoot(x, y);
		if (r === undefined) return dec(toNumber(x) * toNumber(y));
		if (r === null) return rmul(x, y);
		var a1 = qa(x), b1 = qb(x), a2 = qa(y), b2 = qb(y);
		var rr = rat(r, 1n);
		// (a1+b1√r)(a2+b2√r) = a1a2 + b1b2·r + (a1b2 + a2b1)√r
		return quad(radd(rmul(a1, a2), rmul(rmul(b1, b2), rr)),
			radd(rmul(a1, b2), rmul(a2, b1)), r);
	}

	function div(x, y) {
		if (isZero(y)) err("div0");
		if (x.k === "dec" || y.k === "dec") {
			var yn = toNumber(y);
			if (yn === 0) err("div0");
			return dec(toNumber(x) / yn);
		}
		var r = commonRoot(x, y);
		if (r === undefined) return dec(toNumber(x) / toNumber(y));
		if (r === null) return rdiv(x, y);
		// 分母の有理化: 共役 (a2−b2√r) を掛ける
		var a2 = qa(y), b2 = qb(y);
		var rr = rat(r, 1n);
		var denom = rsub(rmul(a2, a2), rmul(rmul(b2, b2), rr));
		if (denom.n === 0n) err("div0");
		var num = mul(x, quad(a2, rmul(b2, rat(-1n, 1n)), r));
		if (num.k === "dec") return dec(num.x / toNumber(denom));
		return quad(rdiv(qa(num), denom), rdiv(qb(num), denom), qr(num) === null ? r : qr(num));
	}

	// √: 有理数は √(n/d)=√(n·d)/d として平方因子をくくり出す
	function sqrtv(v) {
		if (v.k === "dec") {
			if (v.x < 0) err("domain");
			return dec(Math.sqrt(v.x));
		}
		if (v.k === "quad") {
			var x = toNumber(v);
			if (x < 0) err("domain");
			return dec(Math.sqrt(x));
		}
		if (v.n < 0n) err("domain");
		if (v.n === 0n) return rat(0n, 1n);
		var m = v.n * v.d;
		var s = 1n;
		var i = 2n;
		while (i * i <= m && i <= 10000n) {
			while (m % (i * i) === 0n) { m /= i * i; s *= i; }
			i++;
		}
		return quad(rat(0n, 1n), rat(s, v.d), m);
	}

	function neg(v) {
		if (v.k === "dec") return dec(-v.x);
		if (v.k === "rat") return rat(-v.n, v.d);
		return quad(rmul(qa(v), rat(-1n, 1n)), rmul(qb(v), rat(-1n, 1n)), v.r);
	}

	// 小数の表示文字列(有効10桁・あふれはnull)
	function formatDec(x) {
		if (!isFinite(x)) return null;
		var s = String(parseFloat(x.toPrecision(10)));
		if (s.indexOf("e") !== -1 || s.indexOf("E") !== -1) return null;
		if (s.replace("-", "").replace(".", "").length > 12) return null;
		return s;
	}

	global.Exact = {
		rat: rat,
		ratFromString: ratFromString,
		add: add, sub: sub, mul: mul, div: div,
		sqrt: sqrtv, neg: neg,
		toNumber: toNumber,
		formatDec: formatDec
	};
	if (typeof module !== "undefined" && module.exports) module.exports = global.Exact;
})(typeof window !== "undefined" ? window : globalThis);
