// フラッピー棒人間: どのボタンでも羽ばたいて浮き、壁の隙間をくぐる(連射型のワンボタン)。
// インターフェースはランナー(DotGame)と同一。ループは setInterval(rAFはPC非最前面で止まるため)
(function (global) {
	"use strict";

	var GB = ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"];

	var ctx = null, W = 0, H = 0, beep = null;
	var timer = null, last = 0;

	var BIRD_X = 12;     // 棒人間の左端x
	var SPRITE_H = 6;
	var GAP = 16;        // 壁の隙間(ドット)
	var WALL_W = 2;

	// ---- 手触りの調整値(ここをいじると浮き心地が変わる) ----
	var GRAVITY = 93;    // 落下の重さ(小さいほど軽い・ゆっくり落ちる)
	var FLAP = -33;      // 羽ばたきの強さ(マイナスが大きいほど高く浮く=連打が減る)
	var MAX_FALL = 40;   // 落下速度の上限(小さいほどふんわり)

	var st = null;
	var hi = 0;

	function now() {
		return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
	}

	function loadHi() {
		try { hi = parseInt(localStorage.getItem("dotcalc-hi-fly") || "0", 10) || 0; }
		catch (e) { hi = 0; }
	}

	function saveHi() {
		try { localStorage.setItem("dotcalc-hi-fly", String(hi)); } catch (e) { /* 保存できなくても遊べる */ }
	}

	function reset() {
		st = {
			y: Math.floor(H / 2) - 4, // 棒人間の上端y(小数で保持)
			vy: 0,
			speed: 24,                // 壁の流速(ドット/秒)
			walls: [],                // {x, gapY(隙間の上端), passed}
			spawnIn: 0.9,
			score: 0,
			dead: false,
			blink: 0,
			flapAge: 9               // 最後に羽ばたいてからの秒(スプライト切替用)
		};
	}

	function spawn() {
		// 隙間の縦位置はランダム。ただし上下に最低3ドットの壁を残す=必ず通れる(フェア)
		var minY = 3;
		var maxY = H - 3 - GAP - 2; // 下端2ドットは地面ライン
		var gapY = minY + Math.floor(Math.random() * Math.max(1, maxY - minY + 1));
		st.walls.push({ x: W + 1, gapY: gapY, passed: false });
		st.spawnIn = 1.55 * (24 / st.speed) + Math.random() * 0.3;
	}

	function die() {
		st.dead = true;
		st.blink = 0;
		if (st.score > hi) { hi = st.score; saveHi(); }
		if (beep) beep(220, 0.18);
	}

	function update(dt) {
		if (st.dead) {
			st.blink += dt;
			return;
		}
		st.flapAge += dt;
		st.speed += 0.8 * dt;

		// 重力+羽ばたきインパルス(連射型)
		st.vy += GRAVITY * dt;
		if (st.vy > MAX_FALL) st.vy = MAX_FALL;
		st.y += st.vy * dt;
		if (st.y < 1) { st.y = 1; st.vy = 0; } // 天井はクランプ
		if (st.y + SPRITE_H >= H - 2) { die(); return; } // 地面で死亡

		st.spawnIn -= dt;
		if (st.spawnIn <= 0) spawn();

		for (var i = st.walls.length - 1; i >= 0; i--) {
			var wl = st.walls[i];
			wl.x -= st.speed * dt;
			if (!wl.passed && wl.x + WALL_W < BIRD_X) {
				wl.passed = true;
				st.score++;
				if (beep) beep(1320, 0.06);
			}
			if (wl.x + WALL_W < -1) st.walls.splice(i, 1);
		}

		// 当たり判定(棒人間の箱 5×7 vs 壁)
		var by0 = Math.round(st.y), by1 = by0 + SPRITE_H - 1;
		for (var j = 0; j < st.walls.length; j++) {
			var w2 = st.walls[j];
			var wx0 = Math.round(w2.x), wx1 = wx0 + WALL_W - 1;
			if (wx1 >= BIRD_X && wx0 <= BIRD_X + 4) {
				if (by0 < w2.gapY || by1 > w2.gapY + GAP - 1) { die(); return; }
			}
		}
	}

	function drawSprite(rows, x, y) {
		ctx.fillStyle = GB[0];
		for (var r = 0; r < rows.length; r++) {
			for (var c = 0; c < rows[r].length; c++) {
				if (rows[r][c] === "#") ctx.fillRect(x + c, y + r, 1, 1);
			}
		}
	}

	function draw() {
		var F = global.DotFont;
		var SP = global.DotSprites;
		ctx.fillStyle = GB[2];
		ctx.fillRect(0, 0, W, H);
		ctx.fillStyle = GB[0];

		// 地面と天井のライン
		ctx.fillRect(0, H - 2, W, 1);
		ctx.fillRect(0, 0, W, 1);

		// 壁
		for (var i = 0; i < st.walls.length; i++) {
			var wl = st.walls[i];
			var x = Math.round(wl.x);
			ctx.fillRect(x, 1, WALL_W, wl.gapY - 1);
			ctx.fillRect(x, wl.gapY + GAP, WALL_W, (H - 2) - (wl.gapY + GAP));
		}

		// 棒人間(羽ばたき直後0.15秒はFLY_UP)
		var sprite = st.dead ? SP.DEAD : (st.flapAge < 0.15 ? SP.FLY_UP : SP.FLY_DOWN);
		drawSprite(sprite, BIRD_X, Math.round(st.y));

		// スコア(右上)
		var s = String(st.score);
		F.drawText(ctx, s, W - 2 - F.textWidth(s.length), 3, GB[0]);

		if (st.dead) {
			var l1 = "SCORE " + st.score;
			var l2 = "HI " + hi;
			F.drawText(ctx, l1, Math.floor((W - F.textWidth(l1.length)) / 2), 10, GB[0]);
			F.drawText(ctx, l2, Math.floor((W - F.textWidth(l2.length)) / 2), 20, GB[0]);
			if (Math.floor(st.blink * 2) % 2 === 0) {
				F.drawText(ctx, "PUSH", Math.floor((W - F.textWidth(4)) / 2), 32, GB[0]);
			}
		}
	}

	function tick() {
		var t = now();
		var dt = Math.min(0.05, (t - last) / 1000);
		last = t;
		update(dt);
		draw();
	}

	global.DotFlappy = {
		// ゲームパッド定義: 特大の1ボタン(どのキーでも羽ばたき)
		pad: ["act"],
		inputDown: function () { this.input(); },
		inputUp: function () { /* 押しっぱなしは使わない */ },

		start: function (c, w, h, opts) {
			ctx = c; W = w; H = h;
			beep = opts && opts.beep;
			loadHi();
			reset();
			last = now();
			if (timer !== null) clearInterval(timer);
			timer = setInterval(tick, 16);
			tick();
		},
		stop: function () {
			if (timer !== null) clearInterval(timer);
			timer = null;
		},
		// どのボタンでも: 羽ばたき / ゲームオーバー中はもう一度
		input: function () {
			if (st === null) return;
			if (st.dead) {
				reset();
				if (beep) beep(660, 0.07);
			} else {
				st.vy = FLAP;
				st.flapAge = 0;
				if (beep) beep(880, 0.05);
			}
		},
		_state: function () { return st; }
	};
})(typeof window !== "undefined" ? window : globalThis);
