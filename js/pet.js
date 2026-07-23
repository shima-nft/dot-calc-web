// じかんの にわ: 電卓とは完全に独立した自給自足の育成。
//  見守る(画面を開いている)とペットがタネを生む → 畑にまくと実時間で育つ(閉じてても進む) →
//  収穫してごはんにする → ペットが育つ(たまご→けんし)。なでるとなつく。
// 「時間そのものが育てる」循環(出典: 作業ゲームを面白くするには / 目の前に吊られたごほうび /
//  ごほうび要素はまっ先に / クリアできないよりマシ=失敗なしのやさしい設計)。セーブは端末内のみ。
(function (global) {
	"use strict";

	var GB = ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"];

	// ---- 調整値(ここをいじると育つテンポが変わる) ----
	var LEVEL_NEEDS = [3, 5, 8, 12]; // LV1→2..4→5 に必要なごはん回数
	var MAX_LEVEL = 5;
	var STAGE_MS = 100 * 1000;       // 作物が1段階進む実時間(3段階=約5分で実る)
	var SEED_INTERVAL = 40;          // 見守り何秒ごとにタネ+1か
	var SEED_MAX = 9;                // タネの持てる上限
	var WATER_MS = 20 * 1000;        // 水やり1回で早送りする時間
	var WALK = 10;
	var PLOTS = 3;

	var ctx = null, W = 0, H = 0, beep = null;
	var timer = null, last = 0;
	var GROUND = 0;

	var st = null;

	function now() {
		return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
	}
	// 実時刻(セーブのタイムスタンプ用。ブラウザなので Date.now が使える)
	function realNow() {
		return (typeof Date !== "undefined" && Date.now) ? Date.now() : 0;
	}

	// ---- セーブ ----
	function defaultSave() {
		var plots = [];
		for (var i = 0; i < PLOTS; i++) plots.push({ state: "empty", plantedAt: 0, grown: 0 });
		return { level: 1, exp: 0, love: 0, seeds: 1, crops: 0, plots: plots, lastSeen: realNow() };
	}

	function loadSave() {
		try {
			var d = JSON.parse(localStorage.getItem("dotcalc-pet") || "null");
			if (!d || !d.plots) return defaultSave();
			d.level = Math.min(MAX_LEVEL, Math.max(1, d.level | 0 || 1));
			d.exp = d.exp | 0; d.love = d.love | 0;
			d.seeds = Math.min(SEED_MAX, d.seeds | 0); d.crops = d.crops | 0;
			d.lastSeen = d.lastSeen || realNow();
			// plots の健全化
			var ps = [];
			for (var i = 0; i < PLOTS; i++) {
				var p = d.plots[i] || { state: "empty", grown: 0 };
				ps.push({ state: p.state || "empty", grown: p.grown | 0 });
			}
			d.plots = ps;
			return d;
		} catch (e) {
			return defaultSave();
		}
	}

	function save() {
		if (!st) return;
		st.save.lastSeen = realNow();
		try { localStorage.setItem("dotcalc-pet", JSON.stringify(st.save)); } catch (e) { /* 保存不可でも遊べる */ }
	}

	// オフライン中に経過した実時間を各畑の成長に反映(閉じていても畑は育つ)
	function applyElapsed(sv) {
		var elapsed = Math.max(0, realNow() - (sv.lastSeen || realNow()));
		for (var i = 0; i < sv.plots.length; i++) {
			var p = sv.plots[i];
			if (p.state === "growing") {
				p.grown += elapsed;
				if (p.grown >= STAGE_MS * 3) { p.grown = STAGE_MS * 3; p.state = "ripe"; }
			}
		}
	}

	// 畑の見た目(育ち段階)
	function plotSprite(p) {
		var SP = global.DotSprites;
		if (p.state === "empty") return null;
		if (p.state === "ripe") return SP.CROP;
		var stage = Math.floor(p.grown / STAGE_MS); // 0,1,2
		if (stage <= 0) return SP.SEED;
		if (stage === 1) return SP.SPROUT;
		return SP.LEAF;
	}

	function stageSprite(level, eating) {
		var SP = global.DotSprites;
		if (eating && level >= 2) return SP.PET_EAT;
		switch (level) {
			case 1: return SP.PET_EGG;
			case 2: return SP.PET_BABY;
			case 3: return SP.PET_KID;
			case 4: return SP.RUN[0];
		}
		return SP.DUEL_IDLE;
	}

	// カーソル位置: 0..PLOTS-1=畑, PLOTS=ペット
	function cursorSlots() { return PLOTS + 1; }
	function plotX(i) { return 8 + i * 20; }
	var PET_SLOT_X;

	// ---- 更新 ----
	function update(dt) {
		if (st.msgT > 0) st.msgT -= dt;
		if (st.flash > 0) st.flash -= dt;
		if (st.pop > 0) st.pop -= dt;

		// 成長(オンライン中もリアルタイムで進める)
		for (var i = 0; i < st.save.plots.length; i++) {
			var p = st.save.plots[i];
			if (p.state === "growing") {
				p.grown += dt * 1000;
				if (p.grown >= STAGE_MS * 3) { p.grown = STAGE_MS * 3; p.state = "ripe"; }
			}
		}

		// 見守りでタネが生まれる(一緒にいる時間そのものが資源)
		if (st.save.seeds < SEED_MAX) {
			st.watchT += dt;
			if (st.watchT >= SEED_INTERVAL) {
				st.watchT -= SEED_INTERVAL;
				st.save.seeds++;
				st.pop = 0.8; st.msg = "SEED"; st.msgT = 1.0;
				save();
				if (beep) beep(990, 0.05);
			}
		}

		// 食事中はぱくぱく
		if (st.eating > 0) {
			st.eating -= dt;
			if (st.eating <= 0) {
				if (st.save.level < MAX_LEVEL) {
					st.save.exp++;
					var need = LEVEL_NEEDS[st.save.level - 1];
					if (st.save.exp >= need) {
						st.save.exp = 0; st.save.level++;
						st.flash = 0.5; st.msg = "LV UP"; st.msgT = 1.2;
						if (beep) { beep(660, 0.08); beep(880, 0.08); beep(1100, 0.12); }
					}
				} else { st.save.love++; }
				save();
			}
			return;
		}

		// ペットの歩き回り(たまごは動かない)
		if (st.save.level >= 2) {
			st.moveT -= dt;
			if (st.moveT <= 0) {
				var r = Math.random();
				st.dir = r < 0.35 ? -1 : (r < 0.7 ? 1 : 0);
				st.moveT = 0.5 + Math.random() * 1.5;
			}
			st.petX += st.dir * WALK * dt;
			if (st.petX < PET_SLOT_X - 6) { st.petX = PET_SLOT_X - 6; st.dir = 1; }
			if (st.petX > W - 8) { st.petX = W - 8; st.dir = -1; }
		}
	}

	// ---- 描画 ----
	function drawSprite(rows, x, y, flip) {
		if (!rows) return;
		ctx.fillStyle = GB[0];
		for (var r = 0; r < rows.length; r++) {
			for (var c = 0; c < rows[r].length; c++) {
				var col = flip ? (rows[r].length - 1 - c) : c;
				if (rows[r][c] === "#") ctx.fillRect(x + col, y + r, 1, 1);
			}
		}
	}

	function drawHeart(x, y) {
		ctx.fillStyle = GB[0];
		ctx.fillRect(x, y, 1, 1); ctx.fillRect(x + 2, y, 1, 1);
		ctx.fillRect(x, y + 1, 3, 1); ctx.fillRect(x + 1, y + 2, 1, 1);
	}

	function draw() {
		var F = global.DotFont;
		var SP = global.DotSprites;
		ctx.fillStyle = st.flash > 0 ? GB[3] : GB[2];
		ctx.fillRect(0, 0, W, H);
		ctx.fillStyle = GB[0];

		// 地面(スプライトは高さ6=GROUND..GROUND+5、地面線はその下)
		ctx.fillRect(0, GROUND + 6, W, 1);

		// 畑3つ
		for (var i = 0; i < PLOTS; i++) {
			var p = st.save.plots[i];
			var x = plotX(i);
			// 畝(土)
			ctx.fillStyle = GB[0];
			ctx.fillRect(x, GROUND + 5, 5, 1);
			drawSprite(plotSprite(p), x, GROUND, false);
		}
		// ペット
		drawSprite(stageSprite(st.save.level, st.eating > 0), Math.round(st.petX), GROUND, st.dir < 0);

		// カーソル(選んでいるスロットの下に▲)
		var cx = st.cursor < PLOTS ? plotX(st.cursor) + 2 : Math.round(st.petX) + 2;
		ctx.fillStyle = GB[0];
		ctx.fillRect(cx, GROUND + 7, 1, 1);
		ctx.fillRect(cx - 1, GROUND + 8, 3, 1);

		// 上段HUD: LV・ゲージ / タネ / 収穫
		F.drawText(ctx, "LV" + st.save.level, 1, 1, GB[0]);
		if (st.save.level < MAX_LEVEL) {
			var need = LEVEL_NEEDS[st.save.level - 1];
			var gw = 16;
			ctx.fillRect(20, 2, gw, 1); ctx.fillRect(20, 5, gw, 1);
			ctx.fillRect(20, 2, 1, 4); ctx.fillRect(20 + gw - 1, 2, 1, 4);
			ctx.fillRect(20, 3, Math.max(0, Math.round((st.save.exp / need) * gw)), 2);
		} else {
			drawHeart(20, 1); F.drawText(ctx, String(st.save.love), 25, 1, GB[0]);
		}
		// 右上: タネ数(●)と 収穫数(実り)
		drawSprite(SP.SEED, W - 34, 0, false);
		F.drawText(ctx, String(st.save.seeds), W - 28, 1, GB[0]);
		drawSprite(SP.CROP, W - 14, 0, false);
		F.drawText(ctx, String(st.save.crops), W - 8, 1, GB[0]);

		// メッセージ(SEED / LV UP / NO SEED / NEED CROP)
		if (st.msgT > 0 && st.msg) {
			F.drawText(ctx, st.msg, Math.floor((W - F.textWidth(st.msg.length)) / 2), 20, GB[0]);
		}
	}

	function tick() {
		var t = now();
		var dt = Math.min(0.05, (t - last) / 1000);
		last = t;
		update(dt);
		draw();
	}

	function flash(msg) { st.msg = msg; st.msgT = 1.2; }

	global.DotPet = {
		pad: ["left", "right", "guard", "attack"],
		padIcons: { attack: "BTN_FEED", guard: "BTN_CARE" }, // A=ごはん/種まき等, B=お世話

		currentSprite: function () {
			return stageSprite(loadSave().level, false);
		},

		start: function (c, w, h, opts) {
			ctx = c; W = w; H = h;
			beep = opts && opts.beep;
			GROUND = H - 12;
			PET_SLOT_X = plotX(PLOTS - 1) + 20;
			var sv = loadSave();
			applyElapsed(sv); // オフライン成長を反映
			st = {
				save: sv,
				cursor: PLOTS,      // 最初はペットを選択
				petX: PET_SLOT_X,
				dir: 0, moveT: 0.5,
				eating: 0, watchT: 0,
				msg: "", msgT: 0, flash: 0, pop: 0
			};
			save();
			last = now();
			if (timer !== null) clearInterval(timer);
			timer = setInterval(tick, 16);
			tick();
		},
		stop: function () {
			if (timer !== null) clearInterval(timer);
			timer = null;
			save();
		},

		// A(主アクション): 文脈依存 — 空き畑=種まき / 実り=収穫 / ペット=ごはん
		// B(副アクション): 畑=水やり / ペット=なでる
		// action: "attack"(A) | "guard"(B) | "left" | "right"
		inputDown: function (action) {
			if (st === null) return;
			if (action === "left") { st.cursor = (st.cursor + cursorSlots() - 1) % cursorSlots(); if (beep) beep(770, 0.03); return; }
			if (action === "right") { st.cursor = (st.cursor + 1) % cursorSlots(); if (beep) beep(770, 0.03); return; }

			var onPet = st.cursor === PLOTS;
			if (action === "attack") {
				if (onPet) {
					if (st.eating > 0) return;
					if (st.save.crops <= 0) { flash("NEED CROP"); if (beep) beep(330, 0.1); return; }
					st.save.crops--; st.eating = 1.0; save();
					if (beep) beep(880, 0.06);
				} else {
					var p = st.save.plots[st.cursor];
					if (p.state === "empty") {
						if (st.save.seeds <= 0) { flash("NO SEED"); if (beep) beep(330, 0.1); return; }
						st.save.seeds--; p.state = "growing"; p.grown = 0; save();
						if (beep) beep(660, 0.05);
					} else if (p.state === "ripe") {
						p.state = "empty"; p.grown = 0; st.save.crops++; save();
						flash("HARVEST"); if (beep) { beep(880, 0.05); beep(1100, 0.06); }
					}
				}
			} else if (action === "guard") {
				if (onPet) {
					st.save.love++; st.pop = 0.6; save();
					if (beep) beep(1100, 0.05);
				} else {
					var q = st.save.plots[st.cursor];
					if (q.state === "growing") {
						q.grown = Math.min(STAGE_MS * 3, q.grown + WATER_MS);
						if (q.grown >= STAGE_MS * 3) q.state = "ripe";
						save();
						if (beep) beep(600, 0.05);
					}
				}
			}
		},
		inputUp: function () { /* 押しっぱなしは使わない */ },
		_state: function () { return st; }
	};
})(typeof window !== "undefined" ? window : globalThis);
