# motors-site

אתר ידידיה מוטורס — **https://www.yedidia-motors.com** (GitHub Pages, `main` / `(root)`).

---

## מבנה

| נתיב | תפקיד |
|---|---|
| `index.html` | דף הבית. נבנה בקנבס עיצוב — ראו **אזהרות** למטה לפני שנוגעים בו |
| `stock/index.html` | עמוד המלאי — סינון, מיון, גלריה. קורא את `data/inventory.json` |
| `stock/<מזהה>/index.html` | עמוד רכב בודד. **נוצר אוטומטית** ע"י `scripts/seo.mjs` |
| `data/inventory.json` | **החוזה היחיד** בין מקור הנתונים לאתר. נכתב אוטומטית — אין לערוך ידנית |
| `data/site-images.json` | מיפוי תמונות העיצוב לפי slot. נכתב אוטומטית |
| `assets/vehicles/<מזהה>/*.webp` | תמונות הרכבים אחרי המרה וחותמת לוגו |
| `assets/site/<slot>.webp` | תמונות העיצוב (hero, story-finance, story-used, showroom…) |
| `assets/watermark.png` | חותמת הלוגו שמוטבעת על תמונות הרכבים |
| `scripts/sync-inventory.mjs` | מושך את ה-CSV מ-n8n, מנרמל, כותב את ה-JSON, ומפעיל את השניים הבאים |
| `scripts/images.mjs` | מוריד תמונות דרך ה-proxy, ממיר ל-WebP, מטביע לוגו, מנקה יתומים |
| `scripts/seo.mjs` | מייצר עמודי רכב, `sitemap.xml` ו-`llms.txt` |
| `.github/workflows/sync-inventory.yml` | מריץ הכל כל 30 דקות ומקבע שינויים |
| `CNAME` | `www.yedidia-motors.com` |

---

## מאיפה מגיע המלאי

**לא** מגיליון גוגל שפורסם כ-CSV. הקובץ בדרייב הוא **xlsx שהועלה** — אין לו endpoint של CSV,
והוא מלא מידע פנימי (שמות לקוחות, VIN מלא, מחירי מכירה, נזקים) שאסור לפרסם.

לכן הצינור עובר דרך n8n, שקורא את הקובץ, **מסנן את מה שלא מיועד לאתר**, ומחזיר CSV מצומצם:

```
גיליון "מלאי רכבים.xlsx" בדרייב  (הבק אופיס — הצוות עורך)
   ↓  n8n: workflow "מלאי לאתר — CSV מהגיליון"
GET /webhook/inventory.csv?key=…      → CSV נקי לפרסום
GET /webhook/inventory-image?key&id   → תמונה בודדת מהדרייב
GET /webhook/site-images?key          → רשימת תמונות העיצוב
   ↓  GitHub Action, כל 30 דק׳ + Run workflow ידני
scripts/sync-inventory.mjs → images.mjs → seo.mjs
   ↓
data/inventory.json + assets/ + stock/<מזהה>/ + sitemap.xml + llms.txt
   ↓
GitHub Pages בונה מחדש (~דקה)
```

**מה לא עובר לאתר:** VIN מלא (רק 6 התווים האחרונים כמזהה), מחיר מכירה, שם לקוח,
מיקום פיזי, מפתח ספייר, נזקים והערות פנימיות.

**מחירים לא מתפרסמים** — החלטת מוצר. כל כרטיס מציג "לפרטים — צרו קשר" עם קישורי
פנייה, וואטסאפ ועמוד הרכב.

### הגדרה

משתנה יחיד: **Settings → Secrets and variables → Actions → Variables → `SHEET_CSV_URL`**
— כתובת ה-webhook כולל `?key=…`. כתובות ה-proxy לתמונות **נגזרות ממנו**, אין secret נוסף.

הרצה מקומית:

```bash
SHEET_CSV_URL="https://…/webhook/inventory.csv?key=…" node scripts/sync-inventory.mjs
```

דורש `convert` (ImageMagick) בשביל התמונות; בלעדיו התמונות הקיימות פשוט נשארות.

### תמונות הרכבים

התיקייה בדרייב **פרטית ונשארת פרטית**. הגרסה הראשונה פרסמה קישורי `lh3.googleusercontent.com`
ישירות — ומדפדפן שלא מחובר לחשבון גוגל הם נשברו.

> **לקח:** תמיד לבדוק נכסים חיצוניים מדפדפן לא מחובר. דפדפן של הבעלים משקר.

היום ה-Action מוריד כל תמונה דרך ה-proxy, ממיר ל-WebP 1400px, מטביע לוגו, ומקבע ברפו.
**התאמה לרכב לפי שם התיקייה בדרייב:** `<6 תווי שילדה>` / `TI-…` / `<יצרן דגם צבע>`.
מי שמצלם — פותח תיקייה בשם מספר הרכב. תמונות שיושבות בשורש לא משויכות לאף רכב.

---

## ⚠️ אזהרות — לקרוא לפני נגיעה ב-`index.html`

1. **`<style>` ו-DOM רגילים נמחקים.** באנדל העיצוב מחליף את ה-document כולו בזמן הפריסה.
   כל CSS/DOM שנוסף לפני כן נעלם; מאזינים על `window` שורדים.
   הדפוס הקיים: קריאת `<style id="ym-responsive">` **לפני** הפריסה והזרקה מחדש אחריה,
   עם `MutationObserver` + interval ל-60 שניות. אותו דפוס לתגי SEO (`data-ym-seo`).
2. **אסור `dir="rtl"` על `<html>`.** העיצוב מסדר RTL בעצמו; כפיית כיוון על השורש
   מרחיבה את המסמך ל-~10,000px בנייד. `lang="he"` נשאר.
3. **`overflow-x` רק על `html`, לא על `body`.** על `body` הוא הופך אותו ל-scroller פנימי
   ו"הגלילה בנייד לא זזה".
4. **לא `requestAnimationFrame` בקוד שחייב לרוץ בטאב רקע** — rAF לא נורה, ודגל debounce נתקע לתמיד.
5. **`grid-template-columns: 1fr` לא מספיק** — צריך `minmax(0,1fr)` + `min-width:0` על הילדים.
6. **`<image-slot>` חוסם גלילה במגע** — `touch-action:none` בתוך ה-shadow DOM שלו.
   מתוקן בהזרקת `<style data-ym-touch>` לכל slot.
7. **ההתאמות הרספונסיביות תלויות ב-`data-dc-tpl="N"`** — ייצוא מחדש של העיצוב מהקנבס
   ישנה את המזהים **ויפיל אותן**. רכיבי `<image-slot>` נושאים `id` יציב.

> **לקח לבדיקה:** `document.scrollWidth === clientWidth` לא מספיק כדי לקבוע שדף רספונסיבי.
> צריך לסרוק את **כל** האלמנטים. ולגלילה — לבדוק **מי** ה-scroller
> (`body.scrollTop` מול `window.scrollY`), לא רק שהגובה גדול מהמסך.

---

## דומיין

```
yedidia-motors.com.       ALIAS/A   → כתובות GitHub Pages
www.yedidia-motors.com.   CNAME     → yedidiamotors.github.io.
```

> **כלל שנקנה בדם:** קודם רשומת DNS, אחר כך Custom domain.
> קובץ `CNAME` שנוסף לפני שה-DNS קיים מפיל את כל האתר — GitHub Pages מפנה
> את `github.io` לדומיין שלא נפתר. זה קרה כאן פעם אחת.

`allowedOrigins` של ה-webhooks ב-n8n מוגבל ל-
`https://yedidia-motors.com,https://www.yedidia-motors.com,https://yedidiamotors.github.io`.
**כל דומיין חדש חייב להתווסף שם** — גם ב-webhook של הליד וגם בזה של הזדהות העובדים.

---

## אבטחה בקצרה

האתר הוא קבצים סטטיים בלבד — אין קוד שרת, אין חיבור למסד, אין מפתחות ברפו.
ה-proxy מגיש **רק** קבצים מתוך "תמונות אתר"; טופס הפנייה מוגבל בקצב (10/שעה לכל IP)
ובאורך שדות בשתי שכבות; מזהי רכב מנוקים ל-`[A-Za-z0-9_-]` לפני שהם הופכים לנתיב.
פירוט מלא — במסמך `claude/אתר_אבטחה.md` בפרויקט.
