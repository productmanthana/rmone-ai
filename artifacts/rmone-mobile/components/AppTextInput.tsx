import React, { forwardRef } from "react";
import { TextInput } from "react-native";

/**
 * App-wide TextInput wrapper.
 *
 * Android (Gboard) draws a "Suggest contact names?" autofill strip above text
 * fields it thinks may hold a name. That strip is rendered ABOVE the reported
 * keyboard height, so it overlaps inputs that lift with the keyboard (e.g. the
 * AI chat composer), making the field look like it collapses into the keyboard.
 *
 * Disabling autofill / contact suggestions removes the strip everywhere. These
 * are applied as defaults BEFORE `{...props}` so any screen can still override
 * them (e.g. a field that genuinely wants autofill).
 */
export const AppTextInput = forwardRef<
  React.ComponentRef<typeof TextInput>,
  React.ComponentProps<typeof TextInput>
>(
  (props, ref) => {
    return (
      <TextInput
        ref={ref}
        autoComplete="off"
        importantForAutofill="no"
        textContentType="none"
        {...props}
      />
    );
  },
);

AppTextInput.displayName = "AppTextInput";
