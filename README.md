# 🏏 IPL Fantasy Auction - Project Documentation

## 📁 Complete File Structure

```
fantasy-auction/
├── app/
│   ├── auth/
│   │   └── reset-password/
│   │           └── page.tsx
│   │   └── page.tsx                    # Authentication page (Login/Signup)
│   ├── dashboard/
│   │   └── page.tsx                    # Dashboard (Create/Join rooms)
│   ├── room/
│   │   └── [id]/
│   │       └── page.tsx                # Live auction room page
│   ├── favicon.ico                     # App icon
│   ├── globals.css                     # Global styles (Tailwind v4)
│   ├── layout.tsx                      # Root layout
│   └── page.tsx                        # Homepage (redirects to /auth)
├── lib/
│   └── supabase/
│       ├── client.ts                   # Supabase client (browser)
│       └── server.ts                   # Supabase server client
├── .env.local                          # Environment variables (PRIVATE)
├── middleware.ts                       # Auth middleware
├── next.config.ts                      # Next.js configuration
├── package.json                        # Dependencies
├── postcss.config.mjs                  # PostCSS config for Tailwind
├── tsconfig.json                       # TypeScript config
└── README.md                           # This file
```

---

## 📄 Critical Files (Must Have)

### 1. **app/globals.css**
```css
@import "tailwindcss";
```

### 2. **app/layout.tsx**
```typescript
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'IPL Auction - Fantasy Cricket',
  description: 'Real-time fantasy cricket auction platform',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  )
}
```

### 3. **app/page.tsx**
```typescript
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function Home() {
  const router = useRouter()
  
  useEffect(() => {
    router.push('/auth')
  }, [router])

  return null
}
```

### 4. **lib/supabase/client.ts**
```typescript
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

### 5. **lib/supabase/server.ts**
```typescript
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options })
          } catch (error) {
            // Handle cookie setting in Server Components
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options })
          } catch (error) {
            // Handle cookie removal in Server Components
          }
        },
      },
    }
  )
}
```

### 6. **middleware.ts**
```typescript
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value,
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({
            name,
            value,
            ...options,
          })
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value: '',
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({
            name,
            value: '',
            ...options,
          })
        },
      },
    }
  )

  await supabase.auth.getUser()

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

### 7. **.env.local**
```env
NEXT_PUBLIC_SUPABASE_URL=https://dbswnoydeqbbuhadgrpw.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
GEMINI_API_KEY=AIzaSyAz27Ez-SMWjd5YNm6y_WgMfOoAOkOpWhg
```

### 8. **postcss.config.mjs**
```javascript
/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
```

### 9. **package.json**
```json
{
  "name": "fantasy-auction",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint"
  },
  "dependencies": {
    "@heroicons/react": "^2.2.0",
    "@supabase/ssr": "^0.8.0",
    "@supabase/supabase-js": "^2.89.0",
    "canvas-confetti": "^1.9.4",
    "lucide-react": "^0.562.0",
    "next": "16.1.1",
    "react": "19.2.3",
    "react-dom": "19.2.3"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.1.18",
    "@types/canvas-confetti": "^1.9.0",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "16.1.1",
    "tailwindcss": "^4",
    "typescript": "^5"
  }
}
```

---

## 🗑️ Files to DELETE (Old/Unused)

**These files should NOT exist in your project:**

```
❌ pages/                          # Old Pages Router (delete entire folder)
❌ pages/_app.js
❌ pages/index.js
❌ pages/lobby.js
❌ tailwind.config.ts              # Not needed in Tailwind v4
❌ styles/                         # Old styles folder
❌ public/vercel.svg              # Default Next.js files (optional)
```

**Command to delete old files:**
```bash
Remove-Item -Recurse -Force pages
Remove-Item tailwind.config.ts
```

---

## 🗄️ Database Schema (Supabase)

### Tables Created:
1. **rooms** - Auction rooms
2. **room_users** - Users in rooms
3. **room_players** - Players available in room
4. **player_inventory** - Master player list
5. **live_auction_state** - Current auction status
6. **bid_history** - Bid logs
7. **user_squads** - Players owned by users

### Key SQL Functions:
- `initialize_room_players()` - Copies players from inventory to room

---

## 🎨 Pages Overview

### 1. Authentication Page (`/auth`)
- **File**: `app/auth/page.tsx`
- **Features**:
  - Login with email/password
  - Signup with username, email, password
  - Client-side validation
  - Supabase Auth integration

### 2. Dashboard Page (`/dashboard`)
- **File**: `app/dashboard/page.tsx`
- **Features**:
  - Create new auction room
  - Join existing room (room_id + room_key)
  - Rejoin room if already member
  - Display room credentials after creation

### 3. Room/Auction Page (`/room/[id]`)
- **File**: `app/room/[id]/page.tsx`
- **Features**:
  - Live bidding interface
  - Real-time updates via Supabase subscriptions
  - Countdown timers (15s sold / 45s unsold)
  - My Squad, Leaderboard, All Players tabs
  - Admin controls (start auction)

---

## 🔧 Configuration Files

### next.config.ts
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

---

## 🚀 How to Run

### Development:
```bash
npm run dev
```

### Build for Production:
```bash
npm run build
npm start
```

---

## 🔐 Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | `https://xxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | `eyJhbGc...` |
| `GEMINI_API_KEY` | Google Gemini API key | `AIzaSy...` |

---

## 📊 Database Tables Structure

### rooms
- id (UUID)
- room_name (TEXT)
- room_id (TEXT UNIQUE) - Display name like "IPL2025_123"
- room_key (TEXT) - 6-digit code
- admin_user_id (UUID)
- status (TEXT)
- player_inventory_type (TEXT)

### room_users
- id (UUID)
- room_id (UUID FK)
- user_id (UUID FK)
- username (TEXT)
- team_name (TEXT)
- display_name (TEXT) - Format: roomid_team_username
- budget (BIGINT) - Default ₹100 Crore
- spent (BIGINT)
- squad_count (INTEGER)
- is_admin (BOOLEAN)

---

## ✅ Verification Checklist

Use this to verify your setup:

- [ ] No `pages/` folder exists
- [ ] No `tailwind.config.ts` exists
- [ ] `app/globals.css` contains only `@import "tailwindcss";`
- [ ] `.env.local` has all 3 environment variables
- [ ] `postcss.config.mjs` uses `@tailwindcss/postcss`
- [ ] `lib/supabase/client.ts` exists
- [ ] `lib/supabase/server.ts` exists
- [ ] `middleware.ts` exists in root
- [ ] `app/auth/page.tsx` exists
- [ ] `app/dashboard/page.tsx` exists
- [ ] `app/room/[id]/page.tsx` exists

---

## 🐛 Known Issues & Fixes

### Issue 1: Room join showing "User not in room"
**Fix**: Increase retry timeout in `initRoom()` function (already implemented)

### Issue 2: Tailwind not working
**Fix**: Ensure using Tailwind v4 syntax and `@tailwindcss/postcss`

### Issue 3: Authentication not persisting
**Fix**: Ensure `middleware.ts` is present and configured

---

## 📝 Next Steps

### Pending Features:
1. **CSV Player Upload** - Admin page to bulk import players
2. **Timer Automation** - Auto-sell/unsold via Edge Functions
3. **Team Name Selection** - Choose CSK, RCB, MI, etc.
4. **Admin Controls** - Undo bid, reset auction, next player
5. **AI Strategy Analyst** - Gemini integration for bidding advice

---

## 💡 Tips

1. **Always restart dev server** after changing `.env.local`
2. **Clear .next cache** if you face build issues: `Remove-Item -Recurse -Force .next`
3. **Check Supabase logs** in dashboard if database queries fail
4. **Use browser console (F12)** to debug client-side issues

---

## 📞 Support

If you encounter issues:
1. Check browser console for errors (F12)
2. Check Supabase logs in dashboard
3. Verify all files in checklist exist
4. Ensure no old `pages/` folder exists

---

**Last Updated**: December 27, 2024
**Version**: 1.0.0
**Tech Stack**: Next.js 16 + Supabase + Tailwind CSS v4


Last Updates included:

Added password reset mechanism