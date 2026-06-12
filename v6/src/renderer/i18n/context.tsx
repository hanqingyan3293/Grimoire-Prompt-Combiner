import React, { createContext, useContext, useCallback } from 'react'
import { useSettingsStore } from '../stores/settings.store'
import zh from './zh.json'
import en from './en.json'

type Translations = typeof zh

interface I18nContextType {
  t: (key: string) => string
  lang: string
  setLang: (lang: string) => void
}

const I18nContext = createContext<I18nContextType>(null!)

function getNested(obj: any, path: string): string {
  return path.split('.').reduce((o, k) => o?.[k], obj) || path
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const lang = useSettingsStore(s => s.language)
  const setLangFn = useSettingsStore(s => s.setSetting)

  const t = useCallback((key: string): string => {
    const dict = lang === 'zh' ? zh : en
    return getNested(dict, key)
  }, [lang])

  const setLang = (l: string) => setLangFn('language', l)

  return (
    <I18nContext.Provider value={{ t, lang, setLang }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  return useContext(I18nContext)
}