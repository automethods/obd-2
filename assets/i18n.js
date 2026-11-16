const messages = {
  "en": {
    "backCatalogue": "← Back to learning projects",
    "brand": "AutoMethods",
    "modelObd": "Teaching vehicle and enlarged electronic control unit",
    "obdChecksums": "Download checksums",
    "obdDownloadLinux": "Download for Linux",
    "obdDownloadSource": "Source ZIP / Windows",
    "obdDriveText": "Choose a petrol, diesel, HEV, PHEV or BEV preset. Use the cockpit, pedals and gears, or the WLTC virtual driver where supported.",
    "obdDriveTitle": "Drive and compare",
    "obdEyebrow": "VEHICLE CONTROL · SENSORS · DIAGNOSTICS",
    "obdFaultsText": "Disconnect a connector, inspect trouble codes and follow CAN / ISO-TP bytes to the displayed value. Record and export the result.",
    "obdFaultsTitle": "Create and diagnose a fault",
    "obdIllustration": "Original teaching illustration. The ECU is enlarged to show its circuit board and connectors.",
    "obdKeepRecords": "Export recordings before closing the lab; the current session is held in memory.",
    "obdLead": "Follow a signal from the sensor to the ECU, then read the diagnostic answer.",
    "obdLearnTitle": "Explore one connected vehicle",
    "obdLinuxStep": "Linux: save run.sh in a folder, open a terminal there and run:",
    "obdLocalAddress": "Keep the terminal open. The simulator opens at http://127.0.0.1:8765. Press Ctrl+C in the terminal to stop it.",
    "obdLocalNote": "This release runs on your computer with Python 3.10 or newer. Download it here, then open the local simulator in your browser.",
    "obdPageDescription": "An offline vehicle and diagnostic teaching simulator. Download OBD II Lab, inspect sensor signals and explore OBD requests.",
    "obdPageTitle": "OBD II Lab — AutoMethods",
    "obdRequirements": "Python 3.10+ · No extra Python packages · Works offline after download",
    "obdSignalsText": "Inspect fitted units, sensor sampling, connector paths and voltage-to-value conversions. Compare model measurements with diagnostic replies.",
    "obdSignalsTitle": "Trace a signal",
    "obdSourceNote": "The ZIP includes editable source, reference guides and the source launchers.",
    "obdStartTitle": "Start the lab",
    "obdVersion": "Simulator v0.9.10 · English / Ukrainian",
    "obdWindowsStep": "Windows: install Python 3.10 or newer, extract all files from OBDII_Lab.zip, then open START_LAB.bat."
  },
  "uk": {
    "backCatalogue": "← До навчальних проєктів",
    "brand": "АвтоМетод",
    "modelObd": "Навчальний автомобіль і збільшений електронний блок керування",
    "obdChecksums": "Контрольні суми завантажень",
    "obdDownloadLinux": "Завантажити для Linux",
    "obdDownloadSource": "Вихідний ZIP / Windows",
    "obdDriveText": "Оберіть бензиновий, дизельний, HEV, PHEV або BEV варіант. Використовуйте кабіну, педалі й передачі або віртуального водія WLTC для підтримуваних конфігурацій.",
    "obdDriveTitle": "Керуйте й порівнюйте",
    "obdEyebrow": "КЕРУВАННЯ АВТОМОБІЛЕМ · ДАТЧИКИ · ДІАГНОСТИКА",
    "obdFaultsText": "Від’єднайте роз’єм, перевірте коди несправностей і простежте байти CAN / ISO-TP до показаного значення. Запишіть і експортуйте результат.",
    "obdFaultsTitle": "Створюйте й діагностуйте несправності",
    "obdIllustration": "Оригінальна навчальна ілюстрація. ЕБК збільшено, щоб показати його плату й роз’єми.",
    "obdKeepRecords": "Експортуйте записи перед закриттям лабораторії: поточний сеанс зберігається в оперативній пам’яті.",
    "obdLead": "Простежте сигнал від датчика до ЕБК, а потім прочитайте діагностичну відповідь.",
    "obdLearnTitle": "Досліджуйте один спільний автомобіль",
    "obdLinuxStep": "Linux: збережіть run.sh у папці, відкрийте в ній термінал і виконайте:",
    "obdLocalAddress": "Залиште термінал відкритим. Симулятор відкривається за адресою http://127.0.0.1:8765. Для зупинки натисніть Ctrl+C у терміналі.",
    "obdLocalNote": "Ця версія працює на вашому комп’ютері з Python 3.10 або новішим. Завантажте її тут, а потім відкрийте локальний симулятор у браузері.",
    "obdPageDescription": "Автономний навчальний симулятор автомобіля й діагностики. Завантажте OBD II Lab, досліджуйте сигнали датчиків і запити OBD.",
    "obdPageTitle": "OBD II Lab — АвтоМетод",
    "obdRequirements": "Python 3.10+ · Без додаткових пакетів Python · Працює автономно після завантаження",
    "obdSignalsText": "Переглядайте встановлені блоки, вибірки датчиків, шляхи з’єднань і перетворення напруги у значення. Порівнюйте величини моделі з діагностичними відповідями.",
    "obdSignalsTitle": "Простежуйте сигнал",
    "obdSourceNote": "ZIP містить редаговані вихідні файли, довідкові посібники та засоби запуску.",
    "obdStartTitle": "Запуск лабораторії",
    "obdVersion": "Симулятор v0.9.10 · English / Українська",
    "obdWindowsStep": "Windows: установіть Python 3.10 або новіший, розпакуйте всі файли OBDII_Lab.zip і відкрийте START_LAB.bat."
  }
};
let language = globalThis.AutoMethodsLanguage?.language || 'en';
try {
  const saved = localStorage.getItem('motion-lab-language');
  if (saved === 'en' || saved === 'uk') language = saved;
} catch {}
export function t(key, values = {}) {
  return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), messages[language][key] || messages.en[key] || key);
}
function applyLanguage() {
  document.documentElement.lang = language;
  document.documentElement.dataset.language = language;
  for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  for (const attribute of ['aria-label', 'title', 'content', 'alt']) {
    for (const element of document.querySelectorAll(`[data-i18n-${attribute}]`)) element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`)));
  }
  for (const button of document.querySelectorAll('button[data-language]')) button.setAttribute('aria-pressed', String(button.dataset.language === language));
  document.dispatchEvent(new Event('languagechange'));
}
for (const button of document.querySelectorAll('button[data-language]')) button.addEventListener('click', () => {
  language = button.dataset.language;
  try { localStorage.setItem('motion-lab-language', language); } catch {}
  applyLanguage();
});
document.addEventListener('automethodslanguagechange', () => {
  language = globalThis.AutoMethodsLanguage.language;
  applyLanguage();
});
applyLanguage();
