// 棒人間ランナー: 走る棒人間をどのボタンでもジャンプさせて障害物をよける。
// 描画は電卓と同じLCD(97×45・GB4階調)に直描き。人キーで電卓に戻る(ループ停止)。
(function (global) {
	"use strict";

	var GB = ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"];
	// 棒人間の絵は js/sprites.js(DotSprites)で定義。島さんが直接編集できる

	var ctx = null, W = 0, H = 0, beep = null;
	var raf = null, last = 0;

	var GROUND = 0;      // 地面の行(start時に決定)
	var RUNNER_X = 10;   // 棒人間の左端x

	var st = null;       // ゲーム状態
	var hi = 0;

	function loadHi() {
		try { hi = parseInt(localStorage.getItem("dotcalc-hi") || "0", 10) || 0; }
		catch (e) { hi = 0; }
	}

	function saveHi() {
		try { localStorage.setItem("dotcalc-hi", String(hi)); } catch (e) { /* 保存できなくても遊べる */ }
	}

	function reset() {
		st = {
			dist: 0,        // 進んだ距離(ドット)
			speed: 26,      // ドット/秒(進むほど上がる)
			y: 0,           // ジャンプ変位(0=接地・負が上)
			vy: 0,
			grounded: true,
			obstacles: [],  // {x, w, h}
			spawnIn: 1.2,   // 次の障害物までの秒
			dead: false,
			blink: 0
		};
	}

	function spawn() {
		var tall = Math.random() < 0.35;
		st.obstacles.push({
			x: W + 2,
			w: Math.random() < 0.3 ? 2 : 1,
			h: tall ? 5 : 3
		});
		// ジャンプ滞空(約0.55秒)で必ず越えられる間隔を保つ(フェア: 運で死なせない)
		var gap = 0.75 + Math.random() * 0.9;
		st.spawnIn = Math.max(0.65, gap * (34 / st.speed) * 2.2);
	}

	function score() { return Math.floor(st.dist / 6); }

	function update(dt) {
		if (st.dead) {
			st.blink += dt;
			return;
		}
		st.speed += 1.6 * dt;
		st.dist += st.speed * dt;

		st.spawnIn -= dt;
		if (st.spawnIn <= 0) spawn();

		// ジャンプ: 初速+毎フレーム重力(出典: ジャンプのしくみ)
		if (!st.grounded) {
			st.y += st.vy * dt;
			st.vy += 150 * dt;
			if (st.y >= 0) { st.y = 0; st.vy = 0; st.grounded = true; }
		}

		for (var i = st.obstacles.length - 1; i >= 0; i--) {
			var o = st.obstacles[i];
			o.x -= st.speed * dt;
			if (o.x + o.w < 0) st.obstacles.splice(i, 1);
		}

		// 当たり判定(棒人間の箱 5×7 vs 障害物)
		var ry0 = GROUND - 6 + Math.round(st.y);
		var ry1 = ry0 + 5;
		for (var j = 0; j < st.obstacles.length; j++) {
			var ob = st.obstacles[j];
			var ox0 = Math.round(ob.x), ox1 = Math.round(ob.x) + ob.w - 1;
			var oy0 = GROUND - ob.h;
			if (ox1 >= RUNNER_X && ox0 <= RUNNER_X + 4 && ry1 >= oy0) {
				st.dead = true;
				st.blink = 0;
				if (score() > hi) { hi = score(); saveHi(); }
				if (beep) beep(220, 0.18);
				return;
			}
		}

		// 100ごとのごほうび音(目の前に吊られたごほうび)
		var s = score();
		if (s > 0 && s % 100 === 0 && s !== st.lastMilestone) {
			st.lastMilestone = s;
			if (beep) beep(1320, 0.08);
		}
	}

	function drawSprite(rows, x, y, color) {
		ctx.fillStyle = color;
		for (var r = 0; r < rows.length; r++) {
			for (var c = 0; c < rows[r].length; c++) {
				if (rows[r][c] === "#") ctx.fillRect(x + c, y + r, 1, 1);
			}
		}
	}

	function draw() {
		var F = global.DotFont;
		ctx.fillStyle = GB[2];
		ctx.fillRect(0, 0, W, H);
		ctx.fillStyle = GB[0];

		// 地面(進行に合わせて流れる破線=スピード感)
		var off = Math.floor(st.dist) % 4;
		for (var x = -off; x < W; x += 4) {
			ctx.fillRect(Math.max(0, x), GROUND + 1, 2, 1);
		}
		ctx.fillRect(0, GROUND, W, 1);

		// 障害物
		for (var i = 0; i < st.obstacles.length; i++) {
			var o = st.obstacles[i];
			ctx.fillRect(Math.round(o.x), GROUND - o.h, o.w, o.h);
		}

		// 棒人間(コマは DotSprites を参照)
		var SP = global.DotSprites;
		var sprite;
		if (st.dead) {
			sprite = SP.DEAD;
		} else if (!st.grounded) {
			sprite = st.vy < 0 ? SP.JUMP_UP : SP.JUMP_DOWN;
		} else {
			var idx = Math.floor(st.dist / SP.RUN_FRAME_DOTS) % SP.RUN.length;
			sprite = SP.RUN[idx];
		}
		drawSprite(sprite, RUNNER_X, GROUND - 6 + Math.round(st.y), GB[0]);

		// スコア(右上)
		var s = String(score());
		F.drawText(ctx, s, W - 2 - F.textWidth(s.length), 2, GB[0]);

		if (st.dead) {
			// ゲームオーバー: SCORE / HI / PUSH(点滅)
			var l1 = "SCORE " + score();
			var l2 = "HI " + hi;
			F.drawText(ctx, l1, Math.floor((W - F.textWidth(l1.length)) / 2), 10, GB[0]);
			F.drawText(ctx, l2, Math.floor((W - F.textWidth(l2.length)) / 2), 20, GB[0]);
			if (Math.floor(st.blink * 2) % 2 === 0) {
				F.drawText(ctx, "PUSH", Math.floor((W - F.textWidth(4)) / 2), 32, GB[0]);
			}
		}
	}

	// ループは setInterval で駆動する。requestAnimationFrame はウィンドウが最前面でないと
	// 止まってしまい、PCで「電卓のまま固まる」原因になったため(2026-07-19 判明)。
	// setInterval は実時間 dt で進めるので、間隔が乱れても速度は一定に保たれる。
	function tick() {
		var now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
		var dt = Math.min(0.05, (now - last) / 1000);
		last = now;
		update(dt);
		draw();
	}

	global.DotGame = {
		// ゲームパッド定義: 特大の1ボタン(どのキーでもジャンプ)
		pad: ["act"],
		inputDown: function () { this.input(); },
		inputUp: function () { /* 押しっぱなしは使わない */ },

		start: function (c, w, h, opts) {
			ctx = c; W = w; H = h;
			beep = opts && opts.beep;
			GROUND = H - 4;
			loadHi();
			reset();
			last = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
			if (raf !== null) clearInterval(raf);
			raf = setInterval(tick, 16); // 約60fps。非表示時はブラウザが自動で間引く
			tick(); // 開始直後に1回描いて即座に画面を切り替える
		},
		stop: function () {
			if (raf !== null) clearInterval(raf);
			raf = null;
		},
		// どのボタンでも: 接地中ならジャンプ / ゲームオーバー中ならもう一度
		input: function () {
			if (st === null) return;
			if (st.dead) {
				reset();
				if (beep) beep(660, 0.07);
			} else if (st.grounded) {
				st.grounded = false;
				// ジャンプ初速。最高到達点 ≈ vy^2/(2*150)。-42=約5.9ドット(-38の約4.8から1ドット強アップ)
				st.vy = -42;
				if (beep) beep(990, 0.06);
			}
		},
		// テスト用の覗き窓
		_state: function () { return st; }
	};
})(typeof window !== "undefined" ? window : globalThis);
