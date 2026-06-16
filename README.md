# Mobin Hand 3D Studio Pro

پروژه Three.js + Webcam + MediaPipe Hand Landmarker برای ساخت و کنترل اجسام سه‌بعدی با دست.

## اجرا روی سیستم

```bash
npm install
npm run dev
```

بعد آدرس `http://localhost:5173` را باز کن و دسترسی دوربین را Allow کن.

## دیپلوی روی Netlify

Netlify خودش با فایل `netlify.toml` تنظیم شده:

- Build command: `npm run build`
- Publish directory: `dist`
- Node version: `20.11.1`

## کنترل‌ها

- پینچ دست راست، یعنی نزدیک کردن شست و اشاره: ساخت/گرفتن جسم
- حرکت دست: جابه‌جایی جسم انتخاب‌شده
- دو دست با هم: Scale و Rotate جسم
- Space: تغییر شکل
- Backspace/Delete: حذف جسم انتخاب‌شده
- Clear: حذف همه اجسام

## اگر دوربین کار نکرد

1. سایت باید روی `https` یا `localhost` باشد.
2. Permission دوربین در مرورگر باید Allow باشد.
3. روی Chrome تست کن.
4. اگر AdBlock یا Privacy Extension داری، موقتاً خاموش کن چون ممکن است فایل مدل MediaPipe را بلاک کند.
