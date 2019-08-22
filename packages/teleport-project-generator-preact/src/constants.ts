export const customHeadContent = () => `<% if (htmlWebpackPlugin.options.manifest.theme_color) { %>
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

export const customBodyContent = () => `<%= htmlWebpackPlugin.options.ssr({
	url: '/'
}) %>`
