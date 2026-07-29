import { ScrollViewStyleReset } from 'expo-router/html';
import { PropsWithChildren } from 'react';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        <ScrollViewStyleReset />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              html, body, #root {
                direction: rtl;
              }

              body {
                margin: 0;
              }
            `,
          }}
        />
      </head>
      <body dir="rtl">{children}</body>
    </html>
  );
}
