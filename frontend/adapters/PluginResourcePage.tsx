import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../auth';
import { managementPageUrl } from '../transport';

/** Third-party plugin HTML/JS stays on the original CPAMP origin, never Harness. */
export function PluginResourcePage() {
  const { i18n } = useTranslation();
  const params = useParams<{ pluginId: string; menuIndex: string }>();
  const baseUrl = useAuthStore(state => state.apiBase);
  const zh = i18n.language.startsWith('zh');
  let pluginId = params.pluginId || '';
  try { pluginId = decodeURIComponent(pluginId); } catch { /* Preserve malformed identifiers only as safely encoded text. */ }
  const index = Number(params.menuIndex);
  const valid = pluginId.length > 0 && Number.isSafeInteger(index) && index >= 0;
  let href = '';
  try { href = managementPageUrl(baseUrl, valid ? `/plugin-pages/${encodeURIComponent(pluginId)}/${index}` : '/plugins'); } catch { /* No unsafe fallback URL. */ }
  return (
    <section className="cpamp-adapter-notice" role="note">
      <h2>{zh ? '第三方插件页面需在原 CPAMP 中打开' : 'Open third-party plugin pages in CPAMP'}</h2>
      <p>{zh ? '此页面会执行第三方 HTML 或 JavaScript。为保护 Harness 会话与本地权限，不在嵌入后台中加载或代理这类内容。' : 'This page executes third-party HTML or JavaScript. To protect Harness sessions and local permissions, this content is not loaded or proxied inside the embedded manager.'}</p>
      <p>{zh ? '插件商店、安装、启停和配置仍可在本后台使用。只有第三方插件自带页面需要新窗口打开；原站点可能要求单独登录。' : 'The plugin store, installation, enable/disable and configuration remain available here. Only plugin-provided pages open in a separate window; the original site may require its own sign-in.'}</p>
      {href && <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{zh ? '在原 CPAMP 打开此页面' : 'Open this page in the original CPAMP'}</a>}
    </section>
  );
}
