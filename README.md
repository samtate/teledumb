# TeleDumb

A small, self-hosted Telegram client for QVGA CloudPhone feature phones. It talks directly to
Telegram over MTProto and provides a password-protected, D-pad-first web interface.

TeleDumb supports Telegram sign-in, chats, groups, channels, archives, history, unread counts,
replies, editing, deletion, reactions, pins, typing, search, drafts, avatars, and inline media.
It is unofficial and is not affiliated with Telegram.

## Run it

You need Docker Compose, an HTTPS reverse proxy, and API credentials from
[my.telegram.org](https://my.telegram.org). Copy `.env.example` to `.env`, then set:

```dotenv
ADMIN_PASSWORD=a-long-unique-password
SESSION_SECRET=generate-with-openssl-rand-hex-32
PUBLIC_ORIGIN=https://telegram.example.com
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=your-api-hash
```

Start TeleDumb:

```sh
docker compose up -d --build
docker compose logs -f teledumb
```

It listens on `127.0.0.1:8788` by default. Point your HTTPS reverse proxy at that address, open
the public URL, enter the instance password, and follow the Telegram phone number, login code,
and optional two-step-password prompts.

Telegram authorization is stored in `./data`. Keep that directory and `.env` private and backed
up: either can contain sensitive account access. Never expose the container without HTTPS.

## CloudPhone

Create an unpublished CloudPhone widget pointing to `PUBLIC_ORIGIN`, using
`public/teledumb.png` as its icon. Add your phone's IMEI in the developer portal and enable
developer mode. The D-pad navigates, Centre selects, Left opens menus, and Right goes back.

## Development

```sh
bun install
bun test
```

The client uses plain JavaScript and CSS for compatibility with the CloudPhone browser.
