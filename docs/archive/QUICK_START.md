# 🚀 Quick Start Guide - Auction App

## Prerequisites
- Node.js 18+
- Supabase account with project initialized
- Environment variables set up

## Installation & Setup

### 1. Install Dependencies
```bash
cd fantasy-auction
npm install
```

### 2. Verify Environment Variables
Make sure `.env.local` contains:
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
GEMINI_API_KEY=your_api_key (optional for now)
```

### 3. Run Development Server
```bash
npm run dev
```
App will be available at `http://localhost:3000`

---

## 🧪 Testing Flow

### Flow 1: Create Room (Admin)
```
1. Go to http://localhost:3000
2. Sign up → Email: user1@test.com, Password: Test@123
3. Click "Create New Room"
4. Room Name: "MyAuction" (alphanumeric only)
5. Choose Inventory: IPL or T20 World Cup
6. Click "Create Room"
7. ✅ You see: Room ID (MyAuction_XXX) and Room Key (123456)
8. ✅ Display shows: "1 Players" (you as admin)
```

### Flow 2: Join Room (Player)
```
1. Open new browser/incognito window
2. Sign up → Email: user2@test.com, Password: Test@123
3. Click "Join Existing Room"
4. Room ID: MyAuction_XXX (from Flow 1)
5. Room Key: 123456
6. Click "Join Room"
7. ✅ Both users see: "2 Players"
```

### Flow 3: Real-Time Updates
```
1. Keep user1 and user2 in same room
2. Open third browser → user3@test.com
3. user3 joins room
4. ✅ user1 & user2 should instantly see "3 Players"
```

### Flow 4: Start Auction (Admin Only)
```
1. user1 (admin) clicks "Auction" tab
2. When 2+ players present, should see "Start Auction" button
3. Click "Start Auction"
4. ✅ Auction transitions to active state
5. ✅ First player appears with bidding interface
```

---

## 🐛 Debugging

### Check Browser Console
- Open DevTools (F12)
- Look for errors in Console tab
- Check Network tab for failed requests

### Check Supabase Logs
1. Go to Supabase dashboard
2. Go to Logs section
3. Look for database errors

### Common Issues

**Issue**: Room shows "0 Players"
- **Fix**: Refresh the page
- **Expected**: After fix, should show all users in room

**Issue**: Can't join room
- **Check**: Room ID and Key are correct
- **Check**: Room capacity not full
- **Check**: User not already in room

**Issue**: "You are not in this room"
- **Fix**: Wait a few seconds (retry logic is 5 attempts × 1 second)
- **Fix**: Create room again with different name

**Issue**: Page loads but buttons don't work
- **Fix**: Check console for errors
- **Fix**: Verify Supabase credentials in .env.local
- **Fix**: Restart dev server: `npm run dev`

---

## 📊 Database Tables (Verify in Supabase)

You should have these tables:
- ✅ `rooms` - Stores auction rooms
- ✅ `room_users` - Participants in rooms
- ✅ `room_players` - Players available for auction
- ✅ `player_inventory` - Master player list
- ✅ `live_auction_state` - Current auction status
- ✅ `user_squads` - Players purchased by users
- ✅ `bid_history` - Bidding logs

If missing, check `README.md` for SQL to create them.

---

## 🎯 Current Working Features

✅ Authentication (Sign up / Login)
✅ Create Rooms
✅ Join Rooms
✅ View Room Participants (FIXED!)
✅ Real-time User Count Updates (FIXED!)
✅ Leaderboard View
✅ Admin Controls
✅ UI Navigation

---

## ⏱️ Next Steps After Testing

1. **Add Players**: Populate `player_inventory` table with cricket players
2. **Test Bidding**: Place bids, see updates in real-time
3. **Test Auction Flow**: Start → Bid → Sold/Unsold → Next Player
4. **Add AI**: Integrate Gemini API for strategy advisor
5. **Security**: Rotate API keys, add to .gitignore

---

## 📞 Need Help?

- Check browser console for errors
- Verify Supabase tables exist
- Check .env.local is set correctly
- Restart dev server after env changes

---

**Last Updated**: March 1, 2026  
**Status**: Ready for testing ✅
