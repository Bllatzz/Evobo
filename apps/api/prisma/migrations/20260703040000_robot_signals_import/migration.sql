-- One-time historical import from the user's own robotip (CornerIQ) project
-- — see the RobotSignal model comment in schema.prisma. Not RLS-protected
-- like the rest of the schema (no client ever touches this table directly;
-- the backend reads it via Prisma same as everything else, but there's no
-- per-row ownership concept here to write policies against).
CREATE TABLE "robot_signals" (
    "id" INTEGER NOT NULL,
    "bot_name" TEXT,
    "odds" DECIMAL(6,2),
    "home_team" TEXT,
    "away_team" TEXT,
    "robotip_url" TEXT,
    "game_minute" INTEGER,
    "home_odds" DECIMAL(6,2),
    "draw_odds" DECIMAL(6,2),
    "away_odds" DECIMAL(6,2),
    "competition" TEXT,
    "score_home" INTEGER,
    "score_away" INTEGER,
    "last_goal_minute" INTEGER,
    "corners_home" INTEGER,
    "corners_away" INTEGER,
    "last_corner_minute" INTEGER,
    "goals_over_odds" DECIMAL(6,2),
    "stake_pct" DECIMAL(5,1),
    "dangerous_home" INTEGER,
    "dangerous_away" INTEGER,
    "dangerous_per_min_5" TEXT,
    "dangerous_per_min_total" TEXT,
    "yellow_home" INTEGER,
    "yellow_away" INTEGER,
    "red_home" INTEGER,
    "red_away" INTEGER,
    "shots_side_home" INTEGER,
    "shots_side_away" INTEGER,
    "shots_target_home" INTEGER,
    "shots_target_away" INTEGER,
    "possession_home" DECIMAL(5,1),
    "possession_away" DECIMAL(5,1),
    "pi1" DECIMAL(6,2),
    "pi2" DECIMAL(6,2),
    "received_at" TIMESTAMPTZ NOT NULL,
    "result" TEXT NOT NULL DEFAULT 'pending',
    "raw_message" TEXT,

    CONSTRAINT "robot_signals_pkey" PRIMARY KEY ("id")
);
