# رصيد — تطبيق إدارة مالية احترافي

تطبيق **Expo (React Native)** لإدارة المصروفات، المرتب الشهري، الحسابات، والمديونيات مع دعم متعدد العملات وواجهة عربية RTL احترافية.

## المميزات

- لوحة رئيسية بإجمالي الرصيد وصافي الشهر
- تسجيل المصروفات بتصنيفات وحسابات متعددة
- إدخال المرتب الشهري وأي دخل إضافي
- مديونيات (لك / عليك) مع تسجيل السداد الجزئي والكامل
- حسابات: نقدي · بنك · محفظة · ادخار
- 13 عملة شائعة مع تحويل تقريبي لعملة العرض
- جاهز للبناء كـ **Android APK** و **iOS** عبر EAS

## التشغيل

```bash
cd maliya
npm install
npx expo start
```

- ويب للعرض: `npx expo start --web`
- Android: `npx expo start --android` أو `eas build -p android --profile preview`
- iOS: `eas build -p ios --profile production` (يتطلب حساب Apple Developer)

## البناء

```bash
npx eas-cli@latest login
npx eas-cli@latest build -p android --profile preview   # APK
npx eas-cli@latest build -p ios --profile production    # iOS
```
