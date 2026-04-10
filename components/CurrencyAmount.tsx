import React from 'react';
import { View, Text, TextStyle, ViewStyle, StyleSheet } from 'react-native';

interface CurrencyAmountProps {
  amount: number | string;
  currency: string;
  amountStyle?: TextStyle;
  currencyStyle?: TextStyle;
  containerStyle?: ViewStyle;
  showSign?: boolean;
}

export default function CurrencyAmount({
  amount,
  currency,
  amountStyle,
  currencyStyle,
  containerStyle,
  showSign = false,
}: CurrencyAmountProps) {
  const numericAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  const isNegative = numericAmount < 0;
  const absAmount = Math.abs(numericAmount);

  const formattedAmount = absAmount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const displayAmount = showSign
    ? `${isNegative ? '-' : '+'} ${formattedAmount}`
    : formattedAmount;

  return (
    <View style={[styles.container, containerStyle]}>
      <Text style={[styles.currency, currencyStyle]}>{currency}</Text>
      <Text style={[styles.amount, amountStyle]}>{displayAmount}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  currency: {
    textAlign: 'right',
  },
  amount: {
    writingDirection: 'ltr',
    textAlign: 'left',
  },
});
