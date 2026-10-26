STRANGERWAVE — WINDOWS 11 पर चलाने का तरीका

इस ZIP में:
- public/: वेबसाइट का डिज़ाइन, CSS और ब्राउज़र JavaScript
- data/: भविष्य के डेटा के लिए खाली फ़ोल्डर
- server.js: Express और Socket.IO सर्वर
- package.json और package-lock.json: ज़रूरी Node.js पैकेज
- .env.example: उदाहरण environment सेटिंग
- render.yaml: Render पर deploy करने की शुरुआती सेटिंग

अपने कंप्यूटर पर चलाएँ:
1. https://nodejs.org/ से Node.js LTS (18 या नया) इंस्टॉल करें।
2. ZIP पर राइट-क्लिक करके Extract All करें। ZIP के अंदर से सीधे न चलाएँ।
3. निकाले हुए StrangerWave_AI_Project_Language_Arrow फ़ोल्डर को खोलें।
4. ऊपर एड्रेस बार में cmd लिखकर Enter दबाएँ।
5. ये कमांड एक-एक करके चलाएँ:
   npm install
   npm start
6. Chrome में http://localhost:3000 खोलें।

अगर npm नहीं चलता:
- Node.js LTS दोबारा इंस्टॉल करें और Add to PATH चालू रखें।
- Command Prompt बंद करके नया खोलें।
- node -v और npm -v चलाकर जाँचें।
- फिर प्रोजेक्ट फ़ोल्डर में npm install और npm start चलाएँ।

ध्यान दें:
- अभी यह एक ही चल रहे सर्वर से जुड़े दो ब्राउज़र के बीच बेसिक चैट करता है।
- इंटरनेट पर सभी लोगों के लिए चलाने हेतु सर्वर को hosting पर deploy करना होगा।
- Language विकल्प अभी सिर्फ नाम बदलता है; अपने-आप अनुवाद नहीं करता।
- AI Companion/OpenAI replies अभी शामिल नहीं हैं।
- अपनी असली .env फ़ाइल या API key किसी के साथ साझा न करें।
