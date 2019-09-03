export const CUSTOM_HEAD_CONTENT = `<% if (htmlWebpackPlugin.options.manifest.theme_color) { %>
	<meta name="theme-color" content="<%= htmlWebpackPlugin.options.manifest.theme_color %>">
<% } %>
<% for (var chunk of webpack.chunks) { %>
 <% if (chunk.names.length === 1 && chunk.names[0] === 'polyfills') continue; %>
	<% for (var file of chunk.files) { %>
		<% if (htmlWebpackPlugin.options.preload && file.match(/\.(js|css)$/)) { %>
			<link rel="preload" href="<%= htmlWebpackPlugin.files.publicPath + file %>" as="<%= file.match(/\.css$/)?'style':'script' %>">
		<% } else if (file.match(/manifest\.json$/)) { %>
			<link rel="manifest" href="<%= htmlWebpackPlugin.files.publicPath + file %>">
		<% } %>
	<% } %>
<% } %>`

export const CUSTOM_BODY_CONTENT = `<%= htmlWebpackPlugin.options.ssr({
	url: '/'
}) %>`

export const ENTRY_CHUNK = `<%= htmlWebpackPlugin.files.chunks['bundle'].entry %>`

export const POLYFILLS_TAG = `if(typeof fetch==='undefined')document.head.appendChild(document.createElement('script')).src='<%= htmlWebpackPlugin.files.chunks["polyfills"].entry %>'`
