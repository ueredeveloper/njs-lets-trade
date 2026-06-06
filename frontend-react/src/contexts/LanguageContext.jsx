import { createContext, useContext, useState } from 'react';
import { saveUserPrefs } from '../services/api';

const LanguageContext = createContext({ lang: 'pt', setLang: () => {} });

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(
    () => localStorage.getItem('lets_trade_lang') ?? 'pt'
  );

  function setLang(newLang) {
    setLangState(newLang);
    localStorage.setItem('lets_trade_lang', newLang);
    saveUserPrefs({ lang: newLang });
  }

  return (
    <LanguageContext.Provider value={{ lang, setLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
