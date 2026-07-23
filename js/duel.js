// チャンバラ対決: 棒人間の侍1vs1。先に一太刀で勝ち・連勝数がスコア。
// 駆け引き: 斬りは構え→斬撃→大きな隙。ガードで防ぐと相手が仰け反る=反撃チャンス。
// (出典: リスクとリターン / 昇龍拳コマンド / 大事なところはストップ! / コンピュータープレイヤー)
(function (global) {
	"use strict";

	var GB = ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"];

	// ---- 手触りの調整値 ----
	var WALK = 26;          // 歩く速さ(ドット/秒)
	var WINDUP_T = 0.15;    // 構え(振りかぶり)の時間
	var SLASH_T = 0.10;     // 斬撃の持続
	var RECOVER_T = 0.20;   // 空振り/斬った後の隙
	var STAGGER_T = 0.45;   // ガードされた側の仰け反り
	var REACH = 3;          // 刀のリーチ(体の前方ドット)
	var HITSTOP = 0.10;     // ヒットストップ
	var CPU_DELAY0 = 0.40;  // CPUの初期反応秒(連勝で短くなる)
	var CPU_DELAY_MIN = 0.22;

	// ■ 敵の移動スピード(勝つほど速くなる = 難易度上昇)
	// 敵の速さ = WALK ×(1 + CPU_WALK_UP × 連勝数)。上限は CPU_WALK_MAX 倍まで
	var CPU_WALK_UP  = 0.01; // 1勝ごとの上昇量。0.01 = +1%(例: 0.02→+2% / 0→上昇なし)
	var CPU_WALK_MAX = 1.50; // 上限倍率。1.5 = 最大でも1.5倍まで(1.0にすれば上昇しない)

	// ============================================================
	// ■ 魔法の調整(ここをいじる)
	//   絵(詠唱ポーズ・放つポーズ・弾の見た目)は js/sprites.js の
	//   DUEL_CAST / DUEL_FIRE / MAGIC_ORB を書き換える
	// ============================================================
	var CAST_T         = 0.35;  // 詠唱(ためる)時間。長いほど読まれやすい=弱くなる
	var FIRE_T         = 0.12;  // 「放つポーズ」を見せる時間
	var MAGIC_RECOVER  = 0.50;  // 撃った後の隙。長いほどリスク大
	var MAGIC_SPEED0   = 40;    // 弾の速さ(ドット/秒)。大きいほど速い
	// 強化1回ごとの弾速アップ率。0.01 = +1%(例: 0.05→+5% / 0.25→+25%)
	// 実際の弾速 = MAGIC_SPEED0 ×(1 + MAGIC_SPEED_UP ×(魔法をとった回数−1))
	var MAGIC_SPEED_UP = 0.02;
	var MAGIC_Y        = 0;     // 弾の高さ(体の上端から何ドット下を飛ぶか)
	var MAGIC_HIT_W    = 3;     // 弾の当たり判定の幅(見た目と別に決められる)

	// ■ 敵が魔法弾にどう反応するか(1発につき1回だけ判定するので、下の確率どおりになる)
	var CPU_MAGIC_GUARD    = 0.45; // 弾を見てガードする「最初の」確率(0=絶対よけない / 1=必ず防ぐ)
	var CPU_MAGIC_GUARD_UP = 0.02; // 1勝ごとにガード確率が上がる量(勝つほど魔法が通りにくい=難易度上昇)
	var CPU_MAGIC_GUARD_T  = 0.80; // ガードを構えている長さ(秒)。短いと構え損ねる

	// ■ 報酬の調整
	var REWARD_EVERY   = 3;     // 何勝ごとに報酬セレクトを出すか
	var WALK_UP        = 0.10;  // SPEEDを選んだときの移動速度アップ(+10%)

	var SPRITE_W = 5, SPRITE_H = 6;

	var ctx = null, W = 0, H = 0, beep = null, refreshPad = null;
	var timer = null, last = 0;
	var GROUND = 0;

	var st = null;
	var hi = 0;

	function now() {
		return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
	}

	function loadHi() {
		try { hi = parseInt(localStorage.getItem("dotcalc-hi-duel") || "0", 10) || 0; }
		catch (e) { hi = 0; }
	}

	function saveHi() {
		try { localStorage.setItem("dotcalc-hi-duel", String(hi)); } catch (e) { /* 保存不可でも遊べる */ }
	}

	function newFighter(x, face, walkMul) {
		return { x: x, face: face, act: "idle", t: 0, walkMul: walkMul || 1 };
	}

	// 敵の移動速度倍率(連勝が増えるほど速い。上限あり)
	function cpuWalkMul() {
		return Math.min(CPU_WALK_MAX, 1 + st.streak * CPU_WALK_UP);
	}

	function resetRound() {
		st.p = newFighter(18, 1, st.walkMul);                    // 報酬のスピード強化はプレイヤー側
		st.c = newFighter(W - 18 - SPRITE_W, -1, cpuWalkMul());  // 敵は連勝ぶんだけ速くなる
		st.phase = "ready";
		st.phaseT = 0.8;
		st.cpu = { decideIn: 0.3, move: 0, guardT: 0 };
		st.hitstop = 0;
		st.flash = 0;
		st.shake = 0;
		st.pAttackQueued = false; // 前ラウンドの攻撃予約を持ち越さない
		st.pMagicQueued = false;
		st.bullet = null;         // 飛んでいる魔法弾(画面に1発)
	}

	function resetAll() {
		st = {
			streak: 0,
			blink: 0,
			input: { left: false, right: false, guard: false },
			playerWon: false,
			walkMul: 1,        // 報酬でのスピード倍率(ゲームオーバーでリセット)
			magicLv: 0,        // 0=魔法なし / 1以上=習得済み(数が多いほど弾が速い)
			rewardCursor: 0    // 報酬セレクトの選択位置(0=左SPEED / 1=右MAGIC)
		};
		resetRound();
	}

	// ---- プレイヤー/CPU共通の状態機械 ----
	function stepFighter(f, dt, wantLeft, wantRight, wantGuard, wantAttack, wantMagic) {
		if (f.act === "windup" || f.act === "slash" || f.act === "recover" ||
			f.act === "stagger" || f.act === "cast" || f.act === "fire") {
			f.t -= dt;
			if (f.t <= 0) {
				if (f.act === "windup") { f.act = "slash"; f.t = SLASH_T; f.hitDone = false; }
				else if (f.act === "slash") { f.act = "recover"; f.t = RECOVER_T; f.lastWasMagic = false; }
				else if (f.act === "cast") { f.act = "fire"; f.t = FIRE_T; f.fired = false; } // 放つ瞬間
				else if (f.act === "fire") { f.act = "recover"; f.t = MAGIC_RECOVER; f.lastWasMagic = true; }
				else { f.act = "idle"; }
			}
			return;
		}
		if (f.act === "dead") return;
		// idle / guard
		if (wantAttack) {
			f.act = "windup";
			f.t = WINDUP_T;
			if (beep) beep(680, 0.05);
			return;
		}
		if (wantMagic) {
			f.act = "cast";
			f.t = CAST_T;
			if (beep) beep(520, 0.06);
			return;
		}
		if (wantGuard) {
			f.act = "guard";
			return;
		}
		f.act = "idle";
		var dx = 0;
		var walk = WALK * (f.walkMul || 1); // 報酬のスピード強化を反映
		if (wantLeft) dx -= walk * dt;
		if (wantRight) dx += walk * dt;
		f.x += dx;
	}

	function clampPositions() {
		if (st.p.x < 1) st.p.x = 1;
		if (st.c.x > W - 1 - SPRITE_W) st.c.x = W - 1 - SPRITE_W;
		// すれ違い禁止(体1つ分の間隔は保つ)
		if (st.p.x + SPRITE_W + 1 > st.c.x) st.p.x = st.c.x - SPRITE_W - 1;
		if (st.p.x < 1) { st.p.x = 1; if (st.c.x < st.p.x + SPRITE_W + 1) st.c.x = st.p.x + SPRITE_W + 1; }
	}

	// 魔法弾の速さ(強化するほど速い)
	function magicSpeed() {
		return MAGIC_SPEED0 * (1 + MAGIC_SPEED_UP * Math.max(0, st.magicLv - 1));
	}

	// 「放つ」ポーズの瞬間に弾を1発生む
	function spawnBullet(f) {
		if (f.fired) return;
		f.fired = true;
		st.bullet = {
			x: f.face === 1 ? f.x + SPRITE_W : f.x - MAGIC_HIT_W,
			y: GROUND + MAGIC_Y,
			vx: magicSpeed() * f.face
		};
		if (beep) beep(1000, 0.05);
	}

	// 弾を進めて当たりを見る。戻り値: "hit"(勝ち) | "guarded" | null
	function stepBullet(dt, target) {
		if (!st.bullet) return null;
		var b = st.bullet;
		b.x += b.vx * dt;
		if (b.x < -MAGIC_HIT_W || b.x > W + MAGIC_HIT_W) { st.bullet = null; return null; }
		var bx0 = Math.round(b.x), bx1 = bx0 + MAGIC_HIT_W - 1;
		var tx0 = target.x, tx1 = target.x + SPRITE_W - 1;
		if (bx1 < tx0 || bx0 > tx1) return null;
		st.bullet = null;
		if (target.act === "guard") return "guarded"; // ガードで防がれる
		return "hit";
	}

	// 斬撃の命中判定(attacker→defender)。戻り値: "hit" | "guarded" | null
	function checkSlash(a, d) {
		if (a.act !== "slash" || a.hitDone) return null;
		var swordX0, swordX1;
		if (a.face === 1) { swordX0 = a.x + SPRITE_W; swordX1 = swordX0 + REACH; }
		else { swordX1 = a.x - 1; swordX0 = swordX1 - REACH; }
		var dx0 = d.x, dx1 = d.x + SPRITE_W - 1;
		if (swordX1 < dx0 || swordX0 > dx1) return null;
		a.hitDone = true;
		return d.act === "guard" ? "guarded" : "hit";
	}

	// ---- CPUの頭脳(反応遅延つき・人間らしく) ----
	function cpuThink(dt) {
		var c = st.cpu;
		var d = st.c.x - (st.p.x + SPRITE_W); // 間合い
		c.wantAttack = false;
		if (c.guardT > 0) { c.guardT -= dt; }
		c.decideIn -= dt;
		if (c.decideIn > 0) return;
		var delay = Math.max(CPU_DELAY_MIN, CPU_DELAY0 - st.streak * 0.02);
		c.decideIn = delay + Math.random() * 0.12;

		// 魔法弾が飛んできたとき: 1発につき1回だけ「ガードするか」を判定する
		// (反応の遅れを経てから判定するので、撃たれた直後は反応できない=フェア)
		if (st.bullet && st.bullet.vx > 0 && !st.bullet.cpuReacted) {
			st.bullet.cpuReacted = true;
			// 勝つほどガード確率が上がる(上限100%)
			var guardRate = Math.min(1, CPU_MAGIC_GUARD + st.streak * CPU_MAGIC_GUARD_UP);
			if (Math.random() < guardRate) {
				c.guardT = CPU_MAGIC_GUARD_T;
				c.move = 0;
				return;
			}
		}

		var r = Math.random();
		if (d <= REACH + 1) {
			// 間合いの内側: 斬るか、守るか、離れるか
			if (st.p.act === "windup" && r < 0.45) { c.guardT = 0.35 + Math.random() * 0.3; c.move = 0; }
			else if (r < 0.6) { c.wantAttack = true; c.move = 0; }
			else if (r < 0.8) { c.guardT = 0.3 + Math.random() * 0.3; c.move = 0; }
			else { c.move = 1; } // 離れるフェイント
		} else if (d < 26) {
			if (r < 0.55) c.move = -1;           // 詰める
			else if (r < 0.7) c.move = 1;        // 下がるフェイント
			else if (r < 0.85) { c.move = 0; c.guardT = 0.25; }
			else c.move = 0;                     // 様子見
		} else {
			c.move = r < 0.85 ? -1 : 0;          // 遠い: 基本詰める
		}
	}

	function update(dt) {
		if (st.phase === "over") { st.blink += dt; return; }
		if (st.hitstop > 0) { st.hitstop -= dt; return; } // 大事なところはストップ!
		if (st.flash > 0) st.flash -= dt;
		if (st.shake > 0) st.shake -= dt;

		if (st.phase === "ready") {
			st.phaseT -= dt;
			if (st.phaseT <= 0) st.phase = "fight";
			return;
		}
		if (st.phase === "reward") return; // 選ぶまで待つ(入力はinputDownで処理)
		if (st.phase === "roundend") {
			st.phaseT -= dt;
			if (st.phaseT <= 0) {
				if (st.playerWon) {
					st.streak++;
					// 3勝ごとに報酬セレクト(次の戦いの前に選ぶ)
					if (st.streak % REWARD_EVERY === 0) {
						st.phase = "reward";
						st.rewardCursor = 0;
					} else {
						resetRound();
					}
				} else {
					if (st.streak > hi) { hi = st.streak; saveHi(); }
					st.phase = "over";
					st.blink = 0;
				}
			}
			return;
		}

		// fight
		cpuThink(dt);
		var atk = st.pAttackQueued; st.pAttackQueued = false;
		var mag = st.pMagicQueued; st.pMagicQueued = false;
		stepFighter(st.p, dt, st.input.left, st.input.right, st.input.guard, atk, mag);
		var cpu = st.cpu;
		stepFighter(st.c, dt, cpu.move === -1, cpu.move === 1, cpu.guardT > 0, cpu.wantAttack, false);
		clampPositions();

		// 魔法: 放つポーズの瞬間に弾を生成 → 弾を進めて当たり判定
		if (st.p.act === "fire") spawnBullet(st.p);
		var bres = stepBullet(dt, st.c);
		if (bres === "hit") {
			st.c.act = "dead";
			st.playerWon = true;
			st.phase = "roundend"; st.phaseT = 0.9;
			st.hitstop = HITSTOP; st.flash = 0.12; st.shake = 0.25;
			if (beep) beep(1320, 0.12);
			return;
		}
		if (bres === "guarded") {
			st.shake = 0.12;
			if (beep) beep(440, 0.05);
		}

		// 命中判定(同時斬りは相打ち→プレイヤー優先でなく両者チェック順: プレイヤー先)
		var r1 = checkSlash(st.p, st.c);
		if (r1 === "hit") {
			st.c.act = "dead";
			st.playerWon = true;
			st.phase = "roundend"; st.phaseT = 0.9;
			st.hitstop = HITSTOP; st.flash = 0.12; st.shake = 0.25;
			if (beep) beep(1320, 0.12);
			return;
		}
		if (r1 === "guarded") {
			st.p.act = "stagger"; st.p.t = STAGGER_T;
			st.p.x -= 3; // はじかれて下がる
			st.shake = 0.15;
			if (beep) { beep(440, 0.04); beep(520, 0.04); }
		}
		var r2 = checkSlash(st.c, st.p);
		if (r2 === "hit") {
			st.p.act = "dead";
			st.playerWon = false;
			st.phase = "roundend"; st.phaseT = 0.9;
			st.hitstop = HITSTOP; st.flash = 0.12; st.shake = 0.25;
			if (beep) beep(220, 0.18);
			return;
		}
		if (r2 === "guarded") {
			st.c.act = "stagger"; st.c.t = STAGGER_T;
			st.c.x += 3;
			st.shake = 0.15;
			if (beep) { beep(440, 0.04); beep(520, 0.04); }
		}
		clampPositions();
	}

	// ---- 描画 ----
	function drawSprite(rows, x, y, flip) {
		ctx.fillStyle = GB[0];
		for (var r = 0; r < rows.length; r++) {
			for (var c = 0; c < rows[r].length; c++) {
				var col = flip ? (rows[r].length - 1 - c) : c;
				if (rows[r][c] === "#") ctx.fillRect(x + col, y + r, 1, 1);
			}
		}
	}

	function spriteFor(f) {
		var SP = global.DotSprites;
		switch (f.act) {
			case "windup": return SP.DUEL_WINDUP;
			case "slash": return SP.DUEL_SLASH;
			case "cast": return SP.DUEL_CAST;     // 詠唱(ためる)
			case "fire": return SP.DUEL_FIRE;     // 放つ瞬間
			case "recover": return f.lastWasMagic ? SP.DUEL_FIRE : SP.DUEL_SLASH; // 隙はフォロースルー
			case "guard": return SP.DUEL_GUARD;
			case "stagger": return SP.DUEL_STAGGER;
			case "dead": return SP.DEAD;
		}
		return SP.DUEL_IDLE;
	}

	// 報酬セレクト画面(◀▶で選んでAで決定)
	function drawReward(F) {
		var SP = global.DotSprites;
		ctx.fillStyle = GB[2];
		ctx.fillRect(0, 0, W, H);
		ctx.fillStyle = GB[0];
		F.drawText(ctx, "SELECT", Math.floor((W - F.textWidth(6)) / 2), 2, GB[0]);

		// 座標は必ず整数にする(小数だと文字がにじんで別フォントのように見える)
		var leftX = 10, rightX = Math.floor(W / 2) + 6, iconY = 16, labelY = 26;
		var lLabel = "SPEED";
		var rLabel = st.magicLv > 0 ? "MAGIC+" : "MAGIC";
		// アイコンはラベルのちょうど中央上に置く(絵の幅5ドット)
		function iconX(labelX, label) {
			return labelX + Math.floor((F.textWidth(label.length) - 5) / 2);
		}
		// 左: SPEED(走る棒人間)
		drawSprite(SP.RUN[0], iconX(leftX, lLabel), iconY, false);
		F.drawText(ctx, lLabel, leftX, labelY, GB[0]);
		// 右: MAGIC(習得済みなら MAGIC+ =弾速アップ)
		drawSprite(SP.BTN_MAGIC, iconX(rightX, rLabel), iconY, false);
		F.drawText(ctx, rLabel, rightX, labelY, GB[0]);

		// 選択中を下線で示す
		var selX = st.rewardCursor === 0 ? leftX : rightX;
		var selW = st.rewardCursor === 0 ? F.textWidth(5) : F.textWidth(rLabel.length);
		ctx.fillRect(selX, labelY + 8, selW, 1);
	}

	function draw() {
		var F = global.DotFont;
		ctx.fillStyle = st.flash > 0 ? GB[3] : GB[2]; // ヒットの瞬間は明るくフラッシュ
		ctx.fillRect(0, 0, W, H);
		ctx.save();
		if (st.shake > 0) {
			ctx.translate(Math.floor(Math.random() * 3) - 1, Math.floor(Math.random() * 3) - 1);
		}
		ctx.fillStyle = GB[0];

		// 地面
		ctx.fillRect(0, GROUND + SPRITE_H, W, 1);

		// 侍2人(CPUは左右反転)
		var py = GROUND, cy = GROUND;
		drawSprite(spriteFor(st.p), Math.round(st.p.x), py, false);
		drawSprite(spriteFor(st.c), Math.round(st.c.x), cy, true);

		// 斬撃中の刀身(前方へ1ドット線)
		ctx.fillStyle = GB[0];
		if (st.p.act === "slash") ctx.fillRect(Math.round(st.p.x) + SPRITE_W, py + 2, REACH, 1);
		if (st.c.act === "slash") ctx.fillRect(Math.round(st.c.x) - REACH, cy + 2, REACH, 1);

		// 魔法弾(絵は sprites.js の MAGIC_ORB)
		if (st.bullet) drawSprite(global.DotSprites.MAGIC_ORB, Math.round(st.bullet.x), st.bullet.y, st.bullet.vx < 0);

		// 連勝数(右上)
		var s = String(st.streak);
		F.drawText(ctx, s, W - 2 - F.textWidth(s.length), 2, GB[0]);

		if (st.phase === "ready") {
			var t = st.phaseT > 0.3 ? "READY" : "GO";
			F.drawText(ctx, t, Math.floor((W - F.textWidth(t.length)) / 2), 8, GB[0]);
		}
		if (st.phase === "reward") {
			drawReward(F);
		}
		if (st.phase === "over") {
			var l1 = "SCORE " + st.streak;
			var l2 = "HI " + hi;
			F.drawText(ctx, l1, Math.floor((W - F.textWidth(l1.length)) / 2), 8, GB[0]);
			F.drawText(ctx, l2, Math.floor((W - F.textWidth(l2.length)) / 2), 18, GB[0]);
			if (Math.floor(st.blink * 2) % 2 === 0) {
				F.drawText(ctx, "PUSH", Math.floor((W - F.textWidth(4)) / 2), 29, GB[0]);
			}
		}
		ctx.restore();
	}

	function tick() {
		var t = now();
		var dt = Math.min(0.05, (t - last) / 1000);
		last = t;
		update(dt);
		draw();
	}

	global.DotDuel = {
		// ゲームパッド定義(ui.jsが読む): 魔法は習得後にだけボタンが増える
		get pad() {
			var p = ["left", "right", "guard", "attack"];
			if (st && st.magicLv > 0) p.push("magic");
			return p;
		},
		padIcons: { magic: "BTN_MAGIC" },

		start: function (c, w, h, opts) {
			ctx = c; W = w; H = h;
			beep = opts && opts.beep;
			refreshPad = opts && opts.refreshPad;
			GROUND = H - 12;
			loadHi();
			resetAll();
			last = now();
			if (timer !== null) clearInterval(timer);
			timer = setInterval(tick, 16);
			tick();
		},
		stop: function () {
			if (timer !== null) clearInterval(timer);
			timer = null;
		},
		inputDown: function (action) {
			if (st === null) return;
			if (st.phase === "over") {
				resetAll();
				if (refreshPad) refreshPad(); // 報酬がリセットされたので魔法ボタンも消す
				if (beep) beep(660, 0.07);
				return;
			}
			// 報酬セレクト: ◀▶で選んで A で決定
			if (st.phase === "reward") {
				if (action === "left") { st.rewardCursor = 0; if (beep) beep(770, 0.03); }
				else if (action === "right") { st.rewardCursor = 1; if (beep) beep(770, 0.03); }
				else if (action === "attack" || action === "act") {
					if (st.rewardCursor === 0) st.walkMul *= (1 + WALK_UP); // SPEED
					else {
						st.magicLv++;                                       // MAGIC(初回=習得/以降=弾速)
						if (refreshPad) refreshPad();                       // 魔法ボタンを出す
					}
					if (beep) { beep(880, 0.06); beep(1180, 0.08); }
					resetRound();
				}
				return;
			}
			if (action === "left") st.input.left = true;
			else if (action === "right") st.input.right = true;
			else if (action === "guard") st.input.guard = true;
			// 攻撃・魔法は戦闘中だけ予約する(勝利後や開始前の押下を次戦へ持ち越さない)
			else if (action === "attack" || action === "act") { if (st.phase === "fight") st.pAttackQueued = true; }
			else if (action === "magic") { if (st.phase === "fight" && st.magicLv > 0) st.pMagicQueued = true; }
		},
		inputUp: function (action) {
			if (st === null) return;
			if (action === "left") st.input.left = false;
			else if (action === "right") st.input.right = false;
			else if (action === "guard") st.input.guard = false;
		},
		_state: function () { return st; }
	};
})(typeof window !== "undefined" ? window : globalThis);
