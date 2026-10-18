# 📋 Database Schema Setup

## Tables Required

Run these SQL scripts in Supabase SQL Editor to ensure all tables exist.

---

## 1. Rooms Table

```sql
CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_name TEXT NOT NULL,
  room_id TEXT UNIQUE NOT NULL,
  room_key TEXT NOT NULL,
  admin_user_id UUID NOT NULL REFERENCES auth.users(id),
  status TEXT DEFAULT 'WAITING',
  player_inventory_type TEXT DEFAULT 'IPL',
  current_players_count INTEGER DEFAULT 0,
  max_players INTEGER DEFAULT 10,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_rooms_room_id ON rooms(room_id);
CREATE INDEX idx_rooms_admin ON rooms(admin_user_id);
```

---

## 2. Room Users Table

```sql
CREATE TABLE IF NOT EXISTS room_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  budget BIGINT DEFAULT 100000000,
  spent BIGINT DEFAULT 0,
  squad_count INTEGER DEFAULT 0,
  is_admin BOOLEAN DEFAULT false,
  joined_at TIMESTAMP DEFAULT now(),
  UNIQUE(room_id, user_id)
);

CREATE INDEX idx_room_users_room ON room_users(room_id);
CREATE INDEX idx_room_users_user ON room_users(user_id);
```

---

## 3. Player Inventory Table

```sql
CREATE TABLE IF NOT EXISTS player_inventory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_name TEXT NOT NULL,
  player_type TEXT NOT NULL,
  base_price BIGINT NOT NULL,
  image_url TEXT,
  nationality TEXT,
  inventory_type TEXT DEFAULT 'IPL',
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_player_inventory_type ON player_inventory(inventory_type);
```

---

## 4. Room Players Table

```sql
CREATE TABLE IF NOT EXISTS room_players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  player_inventory_id UUID NOT NULL REFERENCES player_inventory(id),
  status TEXT DEFAULT 'UNSOLD',
  sold_price BIGINT,
  sold_to_user_id UUID REFERENCES room_users(id),
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_room_players_room ON room_players(room_id);
CREATE INDEX idx_room_players_status ON room_players(status);
```

---

## 5. Live Auction State Table

```sql
CREATE TABLE IF NOT EXISTS live_auction_state (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL UNIQUE REFERENCES rooms(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT false,
  current_player_id UUID REFERENCES room_players(id),
  current_bid BIGINT DEFAULT 0,
  top_bidder_id UUID REFERENCES room_users(id),
  start_time TIMESTAMP,
  last_bid_time TIMESTAMP,
  timer_type TEXT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_auction_state_room ON live_auction_state(room_id);
```

---

## 6. User Squads Table

```sql
CREATE TABLE IF NOT EXISTS user_squads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_user_id UUID NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES room_players(id),
  purchase_price BIGINT NOT NULL,
  purchased_at TIMESTAMP DEFAULT now(),
  UNIQUE(room_user_id, player_id)
);

CREATE INDEX idx_user_squads_room_user ON user_squads(room_user_id);
```

---

## 7. Bid History Table

```sql
CREATE TABLE IF NOT EXISTS bid_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES room_players(id),
  user_id UUID NOT NULL REFERENCES room_users(id),
  amount BIGINT NOT NULL,
  bid_time TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_bid_history_room ON bid_history(room_id);
CREATE INDEX idx_bid_history_player ON bid_history(player_id);
```

---

## 8. RLS Policies (Row Level Security)

```sql
-- Enable RLS
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_auction_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_squads ENABLE ROW LEVEL SECURITY;
ALTER TABLE bid_history ENABLE ROW LEVEL SECURITY;

-- Allow users to see rooms they're in
CREATE POLICY room_select ON rooms
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM room_users 
      WHERE room_users.room_id = rooms.id 
      AND room_users.user_id = auth.uid()
    )
    OR admin_user_id = auth.uid()
  );

-- Allow users to insert rooms (create)
CREATE POLICY room_insert ON rooms
  FOR INSERT
  WITH CHECK (admin_user_id = auth.uid());

-- Allow anyone to see room_users if they're in the room
CREATE POLICY room_users_select ON room_users
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM room_users AS ru
      WHERE ru.room_id = room_users.room_id
      AND ru.user_id = auth.uid()
    )
  );

-- Allow users to insert themselves to room_users
CREATE POLICY room_users_insert ON room_users
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Similar policies for other tables...
```

---

## 9. SQL Function: Initialize Room Players

```sql
CREATE OR REPLACE FUNCTION initialize_room_players(
  p_room_id UUID,
  p_inventory_type TEXT
)
RETURNS void AS $$
BEGIN
  INSERT INTO room_players (room_id, player_inventory_id, status)
  SELECT p_room_id, id, 'UNSOLD'
  FROM player_inventory
  WHERE inventory_type = p_inventory_type
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;
```

---

## 10. Sample Player Data for IPL

```sql
INSERT INTO player_inventory (player_name, player_type, base_price, nationality, inventory_type)
VALUES
  ('Virat Kohli', 'Batter', 14000000, 'India', 'IPL'),
  ('Rohit Sharma', 'Batter', 14000000, 'India', 'IPL'),
  ('MS Dhoni', 'Wicket Keeper', 14000000, 'India', 'IPL'),
  ('Hardik Pandya', 'All-rounder', 12500000, 'India', 'IPL'),
  ('Jasprit Bumrah', 'Bowler', 12500000, 'India', 'IPL'),
  ('Pat Cummins', 'Bowler', 12500000, 'Australia', 'IPL'),
  ('Sam Curran', 'All-rounder', 10000000, 'England', 'IPL'),
  ('Joe Root', 'Batter', 10000000, 'England', 'IPL'),
  ('Kane Williamson', 'Batter', 14000000, 'New Zealand', 'IPL'),
  ('Babar Azam', 'Batter', 12500000, 'Pakistan', 'IPL');
```

---

## ✅ Verification Checklist

After running all SQL scripts, verify:

```sql
-- Check tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public';

-- Check player_inventory has data
SELECT COUNT(*) FROM player_inventory;

-- Check rooms table
SELECT * FROM rooms LIMIT 1;

-- Check RLS policies
SELECT * FROM pg_policies WHERE tablename = 'room_users';
```

Expected results:
- ✅ 7 tables created
- ✅ At least 10 players in inventory
- ✅ RLS policies enabled

---

## 🚨 If Tables Don't Exist

1. Go to Supabase Dashboard → SQL Editor
2. Create new query
3. Paste the SQL scripts above in order
4. Execute each one
5. Verify they created successfully

---

## 📝 Notes

- All tables use UUID primary keys
- Foreign keys are set with CASCADE delete
- Indexes are created for common queries
- RLS policies are basic - adjust for production
- Initial budget is ₹100 Crore (10,00,00,000 in India rupees)

---

**Last Updated**: March 1, 2026  
**Status**: Ready to execute ✅
