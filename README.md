# A2 English learning resources

"Destination A2" amaliyot sayti: 42 ta unit, har 3 unitdan keyin takrorlash, 2 ta progress test, placement test, xatolar daftari, sinf viktorinasi, bosib chiqariladigan worksheetlar, Kahoot / Quizizz importi uchun jadvallar va telefonlarda o'ynaladigan **Live quiz** (Kahoot'ning o'zimizdagi analogi, pastda). Sayt oddiy statik HTML: server kerak emas, fayl brauzerda ochiladi (yoki Telegram orqali alohida yuboriladi). Faqat Live quiz uchun o'qituvchi kompyuterida `py live.py` ishga tushiriladi. O'quvchi progressi faqat o'sha brauzerda saqlanadi (`localStorage`, `dA2:` kaliti).

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
live.py             Live quiz serveri (o'qituvchi kompyuterida ishlaydi, saytni ham beradi)
live_game.py        Live quiz qoidalari: ball, bosqichlar, jamoalar, CSV (tarmoqsiz, testlanadi)
live/               Live quiz sahifalari: host.html, play.html, live.css, common.js, host.js, play.js
                    va vendor/qrcode.js (MIT litsenziyali QR kutubxonasi)
live-results/       o'yin natijalari (.csv), o'zi yaratiladi, gitga kirmaydi
static/app.css      dizayn (har bir sahifaga inline joylanadi)
static/app.js       o'yinlar, tekshirish, progress, xatolar daftari (inline joylanadi)
artifact-home.html  e'lon qilinadigan artifact uchun kirish sahifasi (generatsiya natijasi)
html/               generatsiya natijasi: unit-XX, worksheet-XX, review-XX, progress-test-X,
                    placement, mistakes, quiz, index, kahoot/, quizizz/, *.zip, xlsx-files.json
tests/              build.py va Live quiz testlari (tests/e2e/ da brauzer bilan tekshiruv)
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

## Live quiz: shu yerning o'zida o'ynaladigan Kahoot

Haqiqiy Kahoot'ni saytning ichida ishlatib bo'lmaydi: u Kahoot'ning o'z serveri va akkauntini talab qiladi, sayt esa unga faqat `.xlsx` jadval bera oladi (pastdagi bo'lim). Shuning uchun repoda o'sha o'yinning o'zimizdagi analogi bor: **`live.py`**. Xuddi Kahoot kabi: o'qituvchi kompyuterda o'yin ochadi, o'quvchilar telefonda PIN bilan qo'shiladi, har savolda tezlikka qarab ball, har savoldan keyin reyting, oxirida podium. Savollar 42 unitdan to'g'ridan-to'g'ri olinadi (har unitning 16 ta test savoli), `.xlsx` yuklash shart emas. Akkaunt ham, internet ham kerak emas; faqat Python 3.12+ (qo'shimcha paket yo'q).

### Ishga tushirish

1. **Tarmoq:** telefonda hotspot yoqing (iPhone: Personal Hotspot, Android: Mobil hotspot) va kompyuterni unga ulang. O'quvchilar ham o'z telefonlarini shu hotspot'ga ulaydi. Maktab Wi-Fi'si ba'zan qurilmalarni bir-biridan ajratib qo'yadi ("client isolation"), shunda telefonlar kompyuterga yetib kelmaydi; hotspot eng ishonchli yo'l.
2. **Server:** loyiha papkasida `py live.py` (Linux/macOS: `python3 live.py`). Brauzerda o'qituvchi sahifasi o'zi ochiladi (ochilmasa: `http://localhost:8000/live/host.html`). Windows birinchi marta tarmoq ruxsatini so'raydi: **Private networks** ga ruxsat bering, aks holda telefonlar ulana olmaydi.
3. **Qo'shilish:** dastur chiqargan manzilni (masalan `http://192.168.43.1:8000/play`) o'quvchilarga ko'rsating: telefonda shuni ochadi yoki ekrandagi QR kodni skanerlaydi (PIN o'zi to'ladi). Kompyuterning bir nechta manzili bo'lsa, qolganlari ham ko'rsatiladi.
4. **O'yin:** o'qituvchi sahifasida unitlarni, savollar sonini (3-50), vaqtni (10-60 soniya) va jamoalarni tanlab **Create game** ni bosing. Katta PIN chiqadi. O'quvchilar PIN va nik (16 belgigacha) kiritadi; keraksiz ismni **×** bilan olib tashlash mumkin. **Start** (yoki Space/Enter).
5. **Savollar:** hamma javob bersa yoki vaqt tugasa savol yopiladi va javoblar, reyting ko'rinadi. **Show answer** (Space) javobni erta ochadi, **Next question** (Space) keyingisiga o'tadi. Oxirida podium.

### Ball

To'g'ri javob tezlikka qarab 500-1000 ball (darhol = 1000, oxirgi soniyada = 500) va ketma-ket to'g'ri javoblar uchun bonus (ikkinchisidan boshlab +100, eng ko'pi +500). Xato yoki javobsiz 0 ball va seriya uziladi. Vaqtni server hisoblaydi (telefon soatiga bog'liq emas). O'yin boshlangandan keyin ham qo'shilish mumkin (0 ball bilan).

### Qo'shimcha imkoniyatlar

- **Jamoa rejimi:** 2-6 jamoa (Lions, Eagles, Tigers, ...). O'quvchilar avtomatik teng taqsimlanadi, jamoa balli a'zolar yig'indisi.
- **Xatolar "My mistakes" daftariga tushadi:** o'quvchi xato javob bergan savol telefonidagi saytning xatolar daftariga yoziladi (qo'shilish oynasidagi katakchadan o'chirish mumkin) va keyin `/mistakes.html` da takrorlanadi; o'sha sahifa shu server orqali ochiladi. Eslatma: brauzer xotirasi manzilga (IP va port) bog'liq, shuning uchun daftar o'sha manzilda saqlanadi. Hotspot IP'si odatda o'zgarmaydi, o'zgarsa daftar "yangi" bo'lib ko'rinadi.
- **Natijalar (CSV):** o'yin tugagach `live-results/` papkasiga o'zi saqlanadi (`yil-oy-kun_soat-PIN.csv`) va podiumdagi **Results (.csv)** tugmasidan ham yuklanadi. Excel'da to'g'ri ochiladi. Birinchi jadval: har o'quvchining bali, to'g'ri javoblar soni, o'rtacha vaqti va har savol natijasi. Ikkinchisi: har savol bo'yicha nechta o'quvchi topgani va foizi; foizi past savollarni qayta tushuntirish kerak.
- **Uzilishga chidamli:** telefon tarmoqdan uzilsa yoki sahifa yangilansa, o'quvchi o'yinga o'zi qaytadi (ekranda "Reconnecting..." chiqadi).

### Cheklovlar

- Faqat shu kompyuterdagi brauzer o'yin yarata va boshqara oladi; boshqa qurilmalar faqat qo'shila oladi (`--allow-remote-host` bilan o'zgartiriladi).
- Shifrlanmagan HTTP, lokal tarmoq (hotspot, sinf Wi-Fi'si) uchun. Internetga ochmang: PIN'ni bilgan istalgan kishi qo'shila oladi. Bir qurilmadan 6 tagacha o'yinchi, bir o'yinda 100 tagacha o'yinchi qo'shiladi.
- Hozircha faqat 3 variantli savollar (yozma javobli bo'sh joy rejimi yo'q). Variantlar tartibi har o'yinda aralashtiriladi.
- O'yin tugagach 30 daqiqa, harakatsiz qolsa 4 soat saqlanadi; server to'xtatilsa (Ctrl+C) faol o'yinlar yo'qoladi, natijalar fayli esa qoladi.
- Haqiqiy Kahoot bilan taqqoslaganda: musiqa, rasmli savollar, o'qituvchi akkaunti va hisobotlar yo'q.

### Sozlamalar

`py live.py --help`: `--port` (standart: 8000 dan boshlab birinchi bo'sh port), `--bind`, `--no-browser`, `--results` (natijalar papkasi), `--allow-remote-host`, `-v` (har so'rovni chiqarish).

## Kahoot va Quizizz bilan ishlash

Bu yerda Kahoot uchun ikki xil yo'l bor, ular bir-biriga o'xshash, lekin boshqa-boshqa narsa. (Akkauntsiz, o'zimizdagi variant uchun yuqoridagi Live quiz bo'limiga qarang.)

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

Testlar manbalar nusxasida `build.py` ni ishga tushiradi va tekshiradi: kontent qoidalari o'tadimi, repodagi `html/` yangi qurilgan natijaga aynan mosmi (ya'ni manbani o'zgartirib qayta qurishni unutmaganmisiz), har bir Kahoot/Quizizz fayli `xlsx-files.json` da bormi. Live quiz uchun alohida testlar bor: `tests/test_live_game.py` (ball, bosqichlar, jamoalar, CSV; soatsiz, tez) va `tests/test_live_server.py` (haqiqiy HTTP: saytni berish, ruxsatlar, yo'l tekshiruvi, oqimlar, o'yin boshidan oxirigacha, natija fayli). Savol ID'larining "My mistakes" daftari bilan mosligi ham tekshiriladi. Brauzerda to'liq tekshiruv `tests/e2e/live.e2e.js` (Playwright kerak, CI'da ishlamaydi): haqiqiy `live.py` ni ishga tushirib, bitta proyektor sahifasi va to'rtta telefon bilan o'yinni oxirigacha o'ynaydi (jamoalar, uzilish, qayta yuklash, CSV, xatolar daftari).

GitHub Actions da bu `.github/workflows/ci.yml` orqali Linux, Windows va macOS da, Python 3.12 va 3.13 bilan ishlaydi.

## Google Drive dan ko'chirish haqida

Manba: Google Drive, `Turbo english/destination-a2` papkasi. Avval `mannod0327-oss/mannod0327-oss` repodagi `claude/stoic-einstein-93dzd1` branchiga qo'yilgan (commit `2839f9a`), keyin shu alohida repoga ajratilgan; birinchi commit shu tarixdan olingan. Ko'chirishda:

- Hamma manba fayllar bayt-ma'nosida Drive dagi fayl hajmiga teng. Manbalardan qayta qurilgan 104 ta HTML va `artifact-home.html` Drive dagi nusxalar bilan aynan bir xil (qator oxiri farqidan tashqari). Kahoot/Quizizz jadvallari (86 fayl) hujayra-hujayra teng.
- **Kiritilmadi:** `__pycache__/` (kompilyatsiya keshi) va Drive dagi `html.zip`. U eski snapshot (29-sentabr): ichida `placement.html` va `mistakes.html` yo'q, barcha 102 sahifasi hozirgi versiyadan farq qiladi. U Drive da qoladi; yangi arxiv kerak bo'lsa `html/` dan qayta zip qilinadi.
- **Bitta o'zgartirish:** `build.py` endi `xlsx-files.json` oxiriga yangi qator qo'shadi (ko'chirish paytida profil reponing CI qoidasi shuni talab qilgan; oddiy matn fayl uchun ham to'g'ri format). JSON mazmuni o'zgarmagan.
- **Qator oxirlari:** Drive dagi HTML lar Windows da qurilgani uchun CRLF bilan edi. Repoda `.gitattributes` (`eol=lf`) tufayli hammasi LF da saqlanadi; brauzerda farq sezilmaydi.
- **Binar fayllar:** `.xlsx` va `.zip` har qurilganda ichidagi vaqt tamg'asi sabab bayt jihatdan o'zgaradi (mazmuni bir xil). Ularni faqat savollar o'zgarganda commit qiling.
