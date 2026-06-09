import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import zh from './locales/zh.json'

// Persist language choice across sessions
const savedLang = localStorage.getItem('wp-studio-lang') || 'en'

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
    lng: savedLang,
    fallbackLng: 'en',
    interpolation: {
      // React already handles XSS escaping
      escapeValue: false,
    },
  })

// Persist whenever the language changes
i18n.on('languageChanged', (lng) => {
  localStorage.setItem('wp-studio-lang', lng)
})

export default i18n