import { useCallback, useRef, useState } from "react";

type Rules<T> = {
  [K in keyof T]?: ((value: T[K], form: T) => string | undefined)[];
};

export function useFormValidation<T extends Record<string, unknown>>(rules: Rules<T>) {
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({});
  const touchedRef = useRef<Partial<Record<keyof T, boolean>>>({});

  const validateField = useCallback(
    (field: keyof T, value: T[keyof T], form: T): string | undefined => {
      const fieldRules = rules[field];
      if (!fieldRules) return undefined;
      for (const rule of fieldRules) {
        const error = rule(value as any, form);
        if (error) return error;
      }
      return undefined;
    },
    [rules],
  );

  const validateAll = useCallback(
    (form: T): boolean => {
      const newErrors: Partial<Record<keyof T, string>> = {};
      let valid = true;
      for (const field of Object.keys(rules) as (keyof T)[]) {
        const error = validateField(field, form[field], form);
        if (error) {
          newErrors[field] = error;
          valid = false;
        }
      }
      setErrors(newErrors);
      const allTouched: Partial<Record<keyof T, boolean>> = {};
      for (const field of Object.keys(rules) as (keyof T)[]) {
        allTouched[field] = true;
      }
      setTouched(allTouched);
      touchedRef.current = allTouched;
      return valid;
    },
    [rules, validateField],
  );

  const onBlur = useCallback(
    (field: keyof T, form: T) => {
      touchedRef.current = { ...touchedRef.current, [field]: true };
      setTouched((prev) => ({ ...prev, [field]: true }));
      const error = validateField(field, form[field], form);
      setErrors((prev) => ({ ...prev, [field]: error }));
    },
    [validateField],
  );

  const onChange = useCallback(
    (field: keyof T, form: T) => {
      if (touchedRef.current[field]) {
        const error = validateField(field, form[field], form);
        setErrors((prev) => ({ ...prev, [field]: error }));
      }
    },
    [validateField],
  );

  const clearErrors = useCallback(() => {
    setErrors({});
    setTouched({});
    touchedRef.current = {};
  }, []);

  const getError = (field: keyof T): string | undefined => {
    return touched[field] ? errors[field] : undefined;
  };

  return { errors, touched, validateAll, onBlur, onChange, clearErrors, getError };
}

// Common validation rules
export const required = (message: string) => (value: unknown) => {
  if (value === undefined || value === null || value === "") return message;
  return undefined;
};

export const minLength = (message: string, min: number) => (value: unknown) => {
  if (typeof value === "string" && value.length > 0 && value.length < min) return message;
  return undefined;
};

export const maxLength = (message: string, max: number) => (value: unknown) => {
  if (typeof value === "string" && value.length > max) return message;
  return undefined;
};

export const isEmail = (message: string) => (value: unknown) => {
  if (typeof value === "string" && value.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    return message;
  return undefined;
};

export const isPositive = (message: string) => (value: unknown) => {
  if (typeof value === "number" && value < 0) return message;
  return undefined;
};

export const minValue = (message: string, min: number) => (value: unknown) => {
  if (typeof value === "number" && value < min) return message;
  return undefined;
};
