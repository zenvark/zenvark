import type {Config} from '@docusaurus/types';
import {themes as prismThemes} from 'prism-react-renderer';
import type * as Preset from '@docusaurus/preset-classic';

export default {
	title: 'Zenvark',
	url: 'https://zenvark.github.io',
	baseUrl: '/zenvark/',
	future: {
		v4: true,
	},
	// favicon: 'img/favicon.ico',
	tagline: 'A robust distributed circuit breaker for high-availability applications',

	onBrokenLinks: 'throw',

	i18n: {
		defaultLocale: 'en',
		locales: ['en'],
	},

	presets: [
		[
			'classic',
			{
				docs: {
					sidebarPath: './sidebars.ts',
					editUrl: 'https://github.com/zenvark/zenvark/tree/main/apps/docs/',
				},
				blog: false,
				theme: {
					customCss: './src/css/custom.css',
				},
			} satisfies Preset.Options,
		],
	],

	themeConfig: {
		// Replace with your project's social card
		image: 'img/docusaurus-social-card.jpg',
		colorMode: {
			respectPrefersColorScheme: true,
		},
		navbar: {
			title: 'Zenvark',
			// logo: {
			// 	alt: 'Zenvark Logo',
			// 	src: 'img/logo.svg',
			// },
			items: [
				{
					type: 'docSidebar',
					label: 'Docs',
					sidebarId: 'tutorialSidebar',
					position: 'left',
				},
				{
					href: 'https://github.com/zenvark/zenvark',
					label: 'GitHub',
					position: 'right',
				},
			],
		},
		footer: {
			style: 'dark',
			links: [
				{
					title: 'Learn',
					items: [
						{
							label: 'Introduction',
							to: '/docs',
						},
						{
							label: 'Installation',
							to: '/docs/getting-started#installation',
						},
					],
				},
				{
					title: 'More',
					items: [
						{
							label: 'GitHub',
							href: 'https://github.com/zenvark/zenvark',
						},
						{
							label: 'npm',
							href: 'https://www.npmjs.com/package/zenvark',
						},
					],
				},
			],
			copyright: `Copyright © ${new Date().getFullYear()} Zenvark`,
		},
		prism: {
			theme: prismThemes.github,
			darkTheme: prismThemes.dracula,
		},
	} satisfies Preset.ThemeConfig,
} satisfies Config
