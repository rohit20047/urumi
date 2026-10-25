{{- define "urumi.wordpressEnv" -}}
- name: WORDPRESS_DB_HOST
  value: {{ printf "%s-mariadb:3306" .Release.Name | quote }}
- name: WORDPRESS_DB_NAME
  value: {{ .Values.database.name | quote }}
- name: WORDPRESS_DB_USER
  value: {{ .Values.database.user | quote }}
- name: WORDPRESS_DB_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ .Values.existingSecret }}
      key: database-password
- name: WORDPRESS_CONFIG_EXTRA
  value: |
    define('WP_HOME', {{ .Values.site.url | squote }});
    define('WP_SITEURL', {{ .Values.site.url | squote }});
    define('WP_MEMORY_LIMIT', '256M');
    define('WP_ENVIRONMENT_TYPE', {{ .Values.site.environment | squote }});
    define('DISALLOW_FILE_EDIT', true);
{{- end -}}
