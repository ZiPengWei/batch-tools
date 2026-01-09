import type { GlobalThemeOverrides } from "naive-ui";
import {
  NConfigProvider,
  NDialogProvider,
  NButton,
  NCheckbox,
  NCheckboxGroup,
  NInput,
  NLoadingBarProvider,
  NMessageProvider,
  NNotificationProvider,
  useDialog,
  useLoadingBar,
  useMessage,
  useNotification,
} from "naive-ui";

export {
  NConfigProvider,
  NDialogProvider,
  NButton,
  NCheckbox,
  NCheckboxGroup,
  NInput,
  NLoadingBarProvider,
  NMessageProvider,
  NNotificationProvider,
  useDialog,
  useLoadingBar,
  useMessage,
  useNotification,
};

export const naiveClsPrefix = "glbt";
export const naiveNamespace = "glbt";

export const naiveThemeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: "#0969da",
    primaryColorHover: "#0550ae",
    primaryColorPressed: "#0a448d",
    successColor: "#1a7f37",
    errorColor: "#cf222e",
    borderRadius: "6px",
  },
};

export const naiveBreakpoints = {
  xs: 0,
  s: 640,
  m: 1024,
  l: 1280,
  xl: 1536,
  xxl: 1920,
};
