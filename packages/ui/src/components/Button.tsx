import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  style,
  ...props
}) => {
  const baseStyle: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: '6px',
    border: 'none',
    cursor: 'pointer',
    fontWeight: '600',
    transition: 'all 0.2s ease',
    outline: 'none'
  };

  const primaryStyle: React.CSSProperties = {
    ...baseStyle,
    backgroundColor: '#3b82f6',
    color: '#ffffff'
  };

  const secondaryStyle: React.CSSProperties = {
    ...baseStyle,
    backgroundColor: '#e2e8f0',
    color: '#1e293b'
  };

  const currentStyle = variant === 'primary' ? primaryStyle : secondaryStyle;

  return (
    <button style={{ ...currentStyle, ...style }} {...props}>
      {children}
    </button>
  );
};
