# Hostile input

<script>window.__castmdXss = 'inline-script';</script>

<img src="x" onerror="window.__castmdXss = 'img-onerror'">

<iframe src="javascript:window.__castmdXss='iframe'"></iframe>

<svg onload="window.__castmdXss = 'svg-onload'"></svg>

[js link](javascript:window.__castmdXss='href')

[data link](data:text/html,<script>window.__castmdXss='data'</script>)

[vbs link](vbscript:msgbox(1))

![broken image](javascript:window.__castmdXss='img-src')

[quote breakout](https://example.com" onmouseover="window.__castmdXss='attr')

`<script>window.__castmdXss = 'code-span'</script>`

```html
<script>window.__castmdXss = 'fenced'</script>
```

| head "quoted" | <b>bold cell</b> |
| --- | --- |
| <script>window.__castmdXss='cell'</script> | plain |
