// 魔导书 Grimoire v7 — i18n 上下文
import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { zh } from './zh'
import { en } from './en'

type Lang = 'zh' | 'en'
type I18nData = typeof zh

interface I18nContextType {
  lang: Lang
  t: I18nData
  setLang: (lang: Lang) => void
}

const I18nContext = createContext<I18nContextType>({
  lang: 'zh',
  t: zh,
  setLang: () => {},
})

export function I18nProvider({ children, initialLang = 'zh' }: { children: ReactNode; initialLang?: Lang }) {
  const [lang, setLang] = useState<Lang>(initialLang)
  const t = lang === 'zh' ? zh : en
  
  const handleSetLang = useCallback((newLang: Lang) => {
    setLang(newLang)
  }, [])
  
  return (
    <I18nContext.Provider value={{ lang, t, setLang: handleSetLang }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  return useContext(I18nContext)
}
