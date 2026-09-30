# A2 English learning resources

"Destination A2" amaliyot sayti: 42 ta unit, har 3 unitdan keyin takrorlash, 2 ta progress test, placement test, xatolar daftari, sinf viktorinasi, bosib chiqariladigan worksheetlar va Kahoot / Quizizz importi uchun jadvallar. Hammasi oddiy statik HTML: server kerak emas, fayl brauzerda ochiladi (yoki Telegram orqali alohida yuboriladi). O'quvchi progressi faqat o'sha brauzerda saqlanadi (`localStorage`, `dA2:` kaliti).

Kontent original: darslikdan ko'chirilmagan, faqat kitob unitlari tartibida tashkil qilingan.

## Tuzilma

```
build.py            generator: ma'lumotlarni tekshiradi va butun saytni quradi
units_a.py          1-14 unitlar (dars, mashqlar, test, speaking/writing vazifasi)
units_b.py          15-28 unitlar
units_c.py          29-42 unitlar
readings_a.py       1-21 unitlar uchun reading matnlari va 5 tadan savol
readings_b.py       22-42 unitlar uchun reading matnlari
review_items.py     14 ta Review va 2 ta Progress Test uchun yangi savollar
static/app.css      dizayn (har bir sahifaga inline joylanadi)
static/app.js       o'yinlar, tekshirish, progress, xatolar daftari (inline joylanadi)
artifact-home.html  e'lon qilinadigan artifact uchun kirish sahifasi (generatsiya natijasi)
html/               generatsiya natijasi: unit-XX, worksheet-XX, review-XX, progress-test-X,
                    placement, mistakes, quiz, index, kahoot/, quizizz/, *.zip, xlsx-files.json
tests/              build.py ni tekshiruvchi testlar
```

`html/` va `artifact-home.html` qo'lda tahrirlanmaydi: manbalarni o'zgartiring va qayta quring.

## Qurish

```
pip install -r requirements.txt     # faqat Kahoot/Quizizz .xlsx fayllari uchun (openpyxl)
python build.py
```

`build.py` avval `validate()` ni ishga tushiradi (unitlar 1..42, har birida A/B/C mashq va 10 ta test savoli, har bir readingda 5 savol, har bir Reviewda 12 MC + 6 gap, Progress Testlarda 30 tadan savol, Review/Progress savollari unit savollarini takrorlamasligi) va shartlar buzilsa `AssertionError` bilan to'xtaydi. Keyin `html/` papkasini va `artifact-home.html` ni qayta yozadi.

## Kontent qo'shish va tahrirlash

Format `units_a.py`, `readings_a.py` va `review_items.py` fayllarining boshidagi izohlarda yozilgan. Qisqacha:

- **MC savol:** `("Savol ___ ...", ["to'g'ri", "xato", "xato"])`. Variantlar tartibini `build.py` o'zi aralashtiradi, to'g'ri javob doim birinchi yoziladi.
- **Gap savol:** `("Gap ___ (fe'l).", ["qabul qilinadigan javob", "muqobil javob"])`, gapda aynan bitta `___` bo'lishi shart.
- **Grammatika unit** `"lesson"` bo'limiga ega, **lug'at unit** esa `"words"` va `"tip"` ga. `UZ:` bilan boshlangan qatorlar o'zbekcha izoh sifatida alohida ko'rsatiladi.
- Har bir savolga uning joyi, matni va to'g'ri javobidan barqaror ID olinadi (`mistakes.html` xatolar daftari savolni shu ID orqali qayta topadi). Savol matni yoki to'g'ri javobini o'zgartirsangiz, yangi ID olinadi va o'quvchining shu savol bo'yicha eski xatolari xatolar daftarida qolmaydi.
- Kahoot uchun savol 95 belgigacha, javob 60 belgigacha bo'lishi kerak; uzunroqlari Kahoot faylidan tushirib qoldiriladi (qurish oxirida `skipped N` deb chiqadi, hozir 0).

## Kahoot va Quizizz bilan ishlash

Bu yerda Kahoot uchun ikki xil yo'l bor, ular bir-biriga o'xshash, lekin boshqa-boshqa narsa.

**1. Haqiqiy Kahoot (o'quvchilar telefondan PIN bilan qo'shiladi).** Saytning o'zi Kahoot o'ynatmaydi: u Kahoot'ga yuklanadigan tayyor jadval beradi.

- Fayllar: `html/kahoot/unit-01.xlsx` ... `unit-42.xlsx`. Har birida shu unitning 16 ta test savoli (har savolda 3 ta variant, 20 soniya). Hammasi bitta arxivda: `html/kahoot-all-units.zip` (ichida 42 ta alohida fayl: arxivni ochib, kerakli unit faylini yuklang).
- Fayl sahifadagi tugmadan emas, to'g'ridan-to'g'ri `html/kahoot/` papkasidan ham olinadi. Sahifa yolg'iz (masalan Telegram'dan) ochilsa, tugmalar fayllarni topa olmaydi: butun `html/` papkasi kerak.
- Kahoot'ning rasmiy yo'riqnomasi bo'yicha: 1) kahoot.com ga o'z akkauntingiz bilan kiring (o'yinni boshlovchi o'qituvchi uchun akkaunt shart); 2) yuqori o'ngdagi **Create** ni bosing; 3) chap panelda **Add question**, so'ng **Import**, eng pastda **Import spreadsheet**; 4) `.xlsx` ni sudrab tashlang yoki **Select file**, keyin **Upload**; 5) Kahoot xatolarni tekshiradi, topilsa tuzatishni yoki o'sha savollarsiz davom etishni taklif qiladi; 6) savollar creator'da paydo bo'ladi: nom bering, **Save**, keyin **Play** va o'quvchilar kahoot.it da PIN kiritadi.
- Kahoot qoidalari (rasmiy): faqat quiz savollari, savol 95 belgigacha, javob 60 belgigacha, kamida 2 ta javob, vaqt 5/10/20/30/60/120 soniya, fayl `.xlsx` va 1 MB dan kichik. Hamma fayl shu qoidalarga mos: 42 fayl, 672 savol tekshirilgan. Gapdagi bo'sh joy `_____` bilan ko'rsatiladi.
- Cheklov: Kahoot ba'zi imkoniyatlarni pullik tarifga bog'laydi (⭐ belgili). Import menyusi ko'rinmasa yoki saqlashda "upgrade" so'rasa, bu Kahoot tarifi bilan bog'liq va bu repodan hal bo'lmaydi.

**2. Saytdagi "Classroom quiz" (`html/quiz.html`).** Akkaunt va internet shart emas. Bu Kahoot-uslubidagi jamoaviy o'yin, lekin o'quvchilar telefon ishlatmaydi: o'qituvchi sahifani proyektorda ko'rsatadi, unitlarni tanlaydi (10-30 savol, savolga 10-45 soniya, 2-4 jamoa), jamoalar og'zaki javob beradi, o'qituvchi **Show answer** ni bosib, to'g'ri topgan jamoaga +1 beradi (Space yoki Enter: keyingi savol, 1-4: jamoaga +1). Oxirida g'oliblar podiumi chiqadi. Sahifa `index.html` dagi "For teachers" bo'limidan ham ochiladi.

**Quizizz / Wayground:** `html/quizizz/unit-XX.xlsx`, import: **Create → Assessment → Import from spreadsheet**.

## Testlar

```
pip install -r requirements-dev.txt
python -m pytest
```

Testlar manbalar nusxasida `build.py` ni ishga tushiradi va tekshiradi: kontent qoidalari o'tadimi, repodagi `html/` yangi qurilgan natijaga aynan mosmi (ya'ni manbani o'zgartirib qayta qurishni unutmaganmisiz), har bir Kahoot/Quizizz fayli `xlsx-files.json` da bormi. GitHub Actions da bu `.github/workflows/ci.yml` orqali Linux, Windows va macOS da, Python 3.12 va 3.13 bilan ishlaydi.

## Google Drive dan ko'chirish haqida

Manba: Google Drive, `Turbo english/destination-a2` papkasi. Avval `mannod0327-oss/mannod0327-oss` repodagi `claude/stoic-einstein-93dzd1` branchiga qo'yilgan (commit `2839f9a`), keyin shu alohida repoga ajratilgan; birinchi commit shu tarixdan olingan. Ko'chirishda:

- Hamma manba fayllar bayt-ma'nosida Drive dagi fayl hajmiga teng. Manbalardan qayta qurilgan 104 ta HTML va `artifact-home.html` Drive dagi nusxalar bilan aynan bir xil (qator oxiri farqidan tashqari). Kahoot/Quizizz jadvallari (86 fayl) hujayra-hujayra teng.
- **Kiritilmadi:** `__pycache__/` (kompilyatsiya keshi) va Drive dagi `html.zip`. U eski snapshot (29-sentabr): ichida `placement.html` va `mistakes.html` yo'q, barcha 102 sahifasi hozirgi versiyadan farq qiladi. U Drive da qoladi; yangi arxiv kerak bo'lsa `html/` dan qayta zip qilinadi.
- **Bitta o'zgartirish:** `build.py` endi `xlsx-files.json` oxiriga yangi qator qo'shadi (ko'chirish paytida profil reponing CI qoidasi shuni talab qilgan; oddiy matn fayl uchun ham to'g'ri format). JSON mazmuni o'zgarmagan.
- **Qator oxirlari:** Drive dagi HTML lar Windows da qurilgani uchun CRLF bilan edi. Repoda `.gitattributes` (`eol=lf`) tufayli hammasi LF da saqlanadi; brauzerda farq sezilmaydi.
- **Binar fayllar:** `.xlsx` va `.zip` har qurilganda ichidagi vaqt tamg'asi sabab bayt jihatdan o'zgaradi (mazmuni bir xil). Ularni faqat savollar o'zgarganda commit qiling.
