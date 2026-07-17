# Putting Fur & Fury online

This game has two parts:

- **The client** (`public/index.html`) — the game itself, runs in the browser.
- **The server** (`server/index.js`) — a small Node.js program that matches players
  up and relays their moves to each other in real time. It needs to run
  somewhere on the internet 24/7 so that people on different devices, anywhere
  in the world, can find each other. It cannot run only on your own computer or
  only inside a Claude session — it has to live on a permanent web address.

The free option below (Render.com) works well for a hobby project like this.
No credit card is required for the free tier.

## Deploying to Render (one-time setup, ~5 minutes)

1. Go to https://render.com and sign up for a free account (you can sign up
   with your GitHub account, which makes the next step easier).
2. Once logged in, click **New +** → **Web Service**.
3. Choose **Build and deploy from a Git repository**, then connect your GitHub
   account if asked, and select the `herrpica/monster-game` repository.
4. Render will detect it's a Node.js project. Fill in:
   - **Name**: anything you like, e.g. `fur-and-fury`
   - **Branch**: the branch you want live (e.g. `claude/tg-26lfmb`, or `main`
     once this is merged)
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: **Free**
5. Click **Create Web Service**. Render will build and start the server —
   this takes a couple of minutes the first time.
6. When it's done, Render gives you a public URL like
   `https://fur-and-fury.onrender.com`. That's the link you and your friends
   use to play — everyone visits that same URL, and the "ONLINE" tab in the
   game will let you Quick Match or create a private room together, from any
   device, anywhere.

## Things to know about the free tier

- Render's free web services go to sleep after periods of no traffic, and
  take ~30-60 seconds to "wake up" on the next visit. If a match doesn't
  start right away, wait a bit and try again — it's just waking up.
- The free tier is fine for a casual game with friends. If it ever becomes
  slow or laggy with more players, Render's paid tiers remove the sleep
  behavior and add more capacity.

## Updating the live game later

Render automatically redeploys whenever new commits land on the branch you
connected. No extra steps needed — just keep working with Claude as normal
and the live site will pick up the changes within a minute or two of a push.

## Playing locally without deploying

You can also just try it on one computer without any of the above:

```
npm install
npm start
```

Then open `http://localhost:3000` in a browser. Local 2-player and vs-CPU
modes always work this way. Online play against other devices requires the
public deployment above, since other devices can't reach `localhost` on your
machine.
