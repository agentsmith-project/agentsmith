'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';

export function CredentialSecretField(args: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  disabled: boolean;
  required?: boolean;
  showValue: boolean;
  showLabel: string;
  hideLabel: string;
  onValueChange: (value: string) => void;
  onToggleVisibility: () => void;
}) {
  const {
    id,
    label,
    value,
    placeholder,
    disabled,
    required = false,
    showValue,
    showLabel,
    hideLabel,
    onValueChange,
    onToggleVisibility,
  } = args;

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          type={showValue ? 'text' : 'password'}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          className="pr-10"
        />
        <button
          type="button"
          onClick={onToggleVisibility}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-tertiary hover:text-foreground"
          aria-label={showValue ? hideLabel : showLabel}
        >
          {showValue ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
