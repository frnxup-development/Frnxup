/* Frnxup multilingual interface layer. Static interface text is translated locally;
   user-generated posts, names, messages and listing descriptions are left untouched. */
(() => {
  if (window.__FRNXUP_LANGUAGE_READY__) return;
  window.__FRNXUP_LANGUAGE_READY__ = true;

  const LANGUAGES = [
    ['en', 'English'], ['yo', 'Yorùbá'], ['ha', 'Hausa'], ['ig', 'Igbo'],
    ['fr', 'Français'], ['ar', 'العربية'], ['pt', 'Português'], ['es', 'Español'],
    ['sw', 'Kiswahili'], ['pcm', 'Nigerian Pidgin'], ['ko', '한국어'], ['zh-CN', '中文（简体）']
  ];

  // English is the source language. Entries not yet translated remain in English.
  const D = {
    yo: {
      'Home':'Ilé','Friends':'Àwọn ọ̀rẹ́','Messages':'Àwọn ìfiranṣẹ́','Rooms':'Àwọn yàrá','Notifications':'Àwọn ìfitónilétí','Marketplace':'Ọjà','Dashboard':'Dasibodu','Profile':'Profaili','Settings':'Ètò','Help':'Ìrànlọ́wọ́',
      'Log in':'Wọlé','Log out':'Jáde','Log Out':'Jáde','Sign in':'Wọlé','Sign up':'Forúkọ sílẹ̀','Create an account':'Ṣẹ̀dá àkọọ́lẹ̀','Create account':'Ṣẹ̀dá àkọọ́lẹ̀','Log in securely':'Wọlé ní ààbò','Email or username':'Ímeèlì tàbí orúkọ aṣàmúlò','Email address':'Àdírẹ́sì ímeèlì','Username':'Orúkọ aṣàmúlò','Password':'Ọ̀rọ̀ aṣínà',
      'Search':'Wá kiri','Cancel':'Fagilé','Save':'Fi pamọ́','Save changes':'Fi àwọn àyípadà pamọ́','Submit':'Fi ránṣẹ́','Send':'Ránṣẹ́','Message':'Ìfiranṣẹ́','Photo':'Fọ́tò','Video':'Fídíò','Latest':'Tuntun jùlọ','All':'Gbogbo','Public':'Fún gbogbo ènìyàn','Private':'Àdáni','Friends only':'Àwọn ọ̀rẹ́ nìkan','Everyone':'Gbogbo ènìyàn','Only me':'Èmi nìkan',
      'Category':'Ẹ̀ka','Description':'Àpèjúwe','Location':'Ibi','About':'Nípa','Explore':'Ṣàwárí','Back':'Padà','See all':'Wo gbogbo rẹ̀','View all':'Wo gbogbo rẹ̀','Create a post':'Ṣẹ̀dá ìtẹ̀jáde','Publish post':'Tẹ ìtẹ̀jáde jáde','Share status':'Pín ipò','Add status':'Fi ipò kún un','Your feed':'Àkójọpọ̀ ìròyìn rẹ','Friend requests':'Àwọn ìbéèrè ọ̀rẹ́','Sent requests':'Àwọn ìbéèrè tí a rán','My friends':'Àwọn ọ̀rẹ́ mi','Your friends':'Àwọn ọ̀rẹ́ rẹ','My listings':'Àwọn ohun tí mo ta','Inbox':'Àpótí ìfiranṣẹ́','Contact seller':'Kàn sí olùtajà','Send message':'Rán ìfiranṣẹ́','Join room':'Darapọ̀ mọ́ yàrá','Create a room':'Ṣẹ̀dá yàrá','Create room':'Ṣẹ̀dá yàrá','Room members':'Àwọn ọmọ ẹgbẹ́ yàrá','Join the room':'Darapọ̀ mọ́ yàrá náà','Mark all as read':'Fi gbogbo wọn àmì pé a ti kà','Profile picture':'Fọ́tò profaili','Cover photo':'Fọ́tò ìbòrí','Display name':'Orúkọ ìfihàn','Bio':'Ìtàn nípa ara rẹ','Edit profile':'Ṣàtúnṣe profaili','Save profile':'Fi profaili pamọ́','Forgot password?':'Ṣé o gbàgbé ọ̀rọ̀ aṣínà?','Continue to sign in':'Tẹ̀síwájú láti wọlé','Return to the homepage':'Padà sí ojú-ìwé àkọ́kọ́','Loading…':'Ó ń ṣiṣẹ́…','Loading...':'Ó ń ṣiṣẹ́…','No one':'Kò sí ẹnikẹ́ni','Nobody':'Kò sí ẹnikẹ́ni'
    },
    ha: {
      'Home':'Gida','Friends':'Abokai','Messages':'Saƙonni','Rooms':'Dakuna','Notifications':'Sanarwa','Marketplace':'Kasuwa','Dashboard':'Allon sarrafawa','Profile':'Bayanan martaba','Settings':'Saituna','Help':'Taimako',
      'Log in':'Shiga','Log out':'Fita','Log Out':'Fita','Sign in':'Shiga','Sign up':'Yi rajista','Create an account':'Ƙirƙiri asusu','Create account':'Ƙirƙiri asusu','Log in securely':'Shiga cikin tsaro','Email or username':'Imel ko sunan mai amfani','Email address':'Adireshin imel','Username':'Sunan mai amfani','Password':'Kalmar sirri',
      'Search':'Bincika','Cancel':'Soke','Save':'Ajiye','Save changes':'Ajiye canje-canje','Submit':'Aika','Send':'Aika','Message':'Saƙo','Photo':'Hoto','Video':'Bidiyo','Latest':'Na baya-bayan nan','All':'Duka','Public':'Na jama’a','Private':'Na sirri','Friends only':'Abokai kaɗai','Everyone':'Kowa','Only me':'Ni kaɗai',
      'Category':'Rukuni','Description':'Bayani','Location':'Wuri','About':'Game da','Explore':'Bincika','Back':'Koma baya','See all':'Duba duka','View all':'Duba duka','Create a post':'Ƙirƙiri rubutu','Publish post':'Wallafa rubutu','Share status':'Raba matsayi','Add status':'Ƙara matsayi','Your feed':'Abubuwan da kake bi','Friend requests':'Buƙatun abokai','Sent requests':'Buƙatun da aka aika','My friends':'Abokaina','Your friends':'Abokanka','My listings':'Kayayyakin da na saka','Inbox':'Akwatin saƙonni','Contact seller':'Tuntuɓi mai sayarwa','Send message':'Aika saƙo','Join room':'Shiga ɗaki','Create a room':'Ƙirƙiri ɗaki','Create room':'Ƙirƙiri ɗaki','Room members':'Mambobin ɗaki','Join the room':'Shiga ɗakin','Mark all as read':'Alama duka a matsayin an karanta','Profile picture':'Hoton bayanin martaba','Cover photo':'Hoton murfi','Display name':'Sunan nunawa','Bio':'Takaitaccen bayani','Edit profile':'Gyara bayanin martaba','Save profile':'Ajiye bayanin martaba','Forgot password?':'Ka manta kalmar sirri?','Continue to sign in':'Ci gaba zuwa shiga','Return to the homepage':'Koma shafin farko','Loading…':'Ana lodawa…','Loading...':'Ana lodawa…','No one':'Babu kowa','Nobody':'Babu kowa'
    },
    ig: {
      'Home':'Ụlọ','Friends':'Ndị enyi','Messages':'Ozi','Rooms':'Ụlọ mkparịta ụka','Notifications':'Ọkwa ozi','Marketplace':'Ahịa','Dashboard':'Dashboard','Profile':'Profaịlụ','Settings':'Ntọala','Help':'Enyemaka',
      'Log in':'Banye','Log out':'Pụọ','Log Out':'Pụọ','Sign in':'Banye','Sign up':'Debanye aha','Create an account':'Mepụta akaụntụ','Create account':'Mepụta akaụntụ','Log in securely':'Banye n’ụzọ nchekwa','Email or username':'Email ma ọ bụ aha njirimara','Email address':'Adreesị email','Username':'Aha njirimara','Password':'Okwuntughe',
      'Search':'Chọọ','Cancel':'Kagbuo','Save':'Chekwaa','Save changes':'Chekwaa mgbanwe','Submit':'Zipu','Send':'Zipu','Message':'Ozi','Photo':'Foto','Video':'Vidiyo','Latest':'Ndị kacha ọhụrụ','All':'Ha niile','Public':'Nke ọha','Private':'Nke onwe','Friends only':'Ndị enyi naanị','Everyone':'Onye ọ bụla','Only me':'Mụ naanị',
      'Category':'Ụdị','Description':'Nkọwa','Location':'Ebe','About':'Maka','Explore':'Chọpụta','Back':'Laghachi','See all':'Lee ha niile','View all':'Lee ha niile','Create a post':'Mepụta mbipụta','Publish post':'Bipụta ozi','Share status':'Kesaa ọnọdụ','Add status':'Tinye ọnọdụ','Your feed':'Ozi gị','Friend requests':'Arịrịọ ndị enyi','Sent requests':'Arịrịọ ezigara','My friends':'Ndị enyi m','Your friends':'Ndị enyi gị','My listings':'Ihe m tinyere n’ahịa','Inbox':'Igbe ozi','Contact seller':'Kpọtụrụ onye na-ere','Send message':'Zipu ozi','Join room':'Banye n’ụlọ','Create a room':'Mepụta ụlọ','Create room':'Mepụta ụlọ','Room members':'Ndị otu ụlọ','Join the room':'Banye n’ụlọ ahụ','Mark all as read':'Kaa ha niile dị ka agụọla','Profile picture':'Foto profaịlụ','Cover photo':'Foto mkpuchi','Display name':'Aha ngosi','Bio':'Nkọwa onwe','Edit profile':'Dezie profaịlụ','Save profile':'Chekwaa profaịlụ','Forgot password?':'Chefuru okwuntughe?','Continue to sign in':'Gaa n’ihu ịbanye','Return to the homepage':'Laghachi na ibe mbụ','Loading…':'Na-ebu…','Loading...':'Na-ebu…','No one':'Ọ dịghị onye','Nobody':'Ọ dịghị onye'
    },
    fr: {
      'Home':'Accueil','Friends':'Amis','Messages':'Messages','Rooms':'Salons','Notifications':'Notifications','Marketplace':'Marché','Dashboard':'Tableau de bord','Profile':'Profil','Settings':'Paramètres','Help':'Aide',
      'Log in':'Se connecter','Log out':'Se déconnecter','Log Out':'Se déconnecter','Sign in':'Connexion','Sign up':'S’inscrire','Create an account':'Créer un compte','Create account':'Créer un compte','Log in securely':'Se connecter en toute sécurité','Email or username':'E-mail ou nom d’utilisateur','Email address':'Adresse e-mail','Username':'Nom d’utilisateur','Password':'Mot de passe',
      'Search':'Rechercher','Cancel':'Annuler','Save':'Enregistrer','Save changes':'Enregistrer les modifications','Submit':'Soumettre','Send':'Envoyer','Message':'Message','Photo':'Photo','Video':'Vidéo','Latest':'Les plus récents','All':'Tout','Public':'Public','Private':'Privé','Friends only':'Amis uniquement','Everyone':'Tout le monde','Only me':'Moi uniquement',
      'Category':'Catégorie','Description':'Description','Location':'Emplacement','About':'À propos','Explore':'Explorer','Back':'Retour','See all':'Tout voir','View all':'Tout afficher','Create a post':'Créer une publication','Publish post':'Publier','Share status':'Partager un statut','Add status':'Ajouter un statut','Your feed':'Votre fil','Friend requests':'Demandes d’amis','Sent requests':'Demandes envoyées','My friends':'Mes amis','Your friends':'Vos amis','My listings':'Mes annonces','Inbox':'Boîte de réception','Contact seller':'Contacter le vendeur','Send message':'Envoyer un message','Join room':'Rejoindre le salon','Create a room':'Créer un salon','Create room':'Créer un salon','Room members':'Membres du salon','Join the room':'Rejoindre le salon','Mark all as read':'Tout marquer comme lu','Profile picture':'Photo de profil','Cover photo':'Photo de couverture','Display name':'Nom affiché','Bio':'Biographie','Edit profile':'Modifier le profil','Save profile':'Enregistrer le profil','Forgot password?':'Mot de passe oublié ?','Continue to sign in':'Continuer vers la connexion','Return to the homepage':'Retour à la page d’accueil','Loading…':'Chargement…','Loading...':'Chargement…','No one':'Personne','Nobody':'Personne'
    },
    ar: {
      'Home':'الرئيسية','Friends':'الأصدقاء','Messages':'الرسائل','Rooms':'الغرف','Notifications':'الإشعارات','Marketplace':'السوق','Dashboard':'لوحة التحكم','Profile':'الملف الشخصي','Settings':'الإعدادات','Help':'المساعدة',
      'Log in':'تسجيل الدخول','Log out':'تسجيل الخروج','Log Out':'تسجيل الخروج','Sign in':'دخول','Sign up':'إنشاء حساب','Create an account':'إنشاء حساب','Create account':'إنشاء حساب','Log in securely':'تسجيل الدخول بأمان','Email or username':'البريد الإلكتروني أو اسم المستخدم','Email address':'عنوان البريد الإلكتروني','Username':'اسم المستخدم','Password':'كلمة المرور',
      'Search':'بحث','Cancel':'إلغاء','Save':'حفظ','Save changes':'حفظ التغييرات','Submit':'إرسال','Send':'إرسال','Message':'رسالة','Photo':'صورة','Video':'فيديو','Latest':'الأحدث','All':'الكل','Public':'عام','Private':'خاص','Friends only':'الأصدقاء فقط','Everyone':'الجميع','Only me':'أنا فقط',
      'Category':'الفئة','Description':'الوصف','Location':'الموقع','About':'حول','Explore':'استكشف','Back':'رجوع','See all':'عرض الكل','View all':'عرض الكل','Create a post':'إنشاء منشور','Publish post':'نشر المنشور','Share status':'مشاركة الحالة','Add status':'إضافة حالة','Your feed':'آخر الأخبار لديك','Friend requests':'طلبات الصداقة','Sent requests':'الطلبات المرسلة','My friends':'أصدقائي','Your friends':'أصدقاؤك','My listings':'إعلاناتي','Inbox':'صندوق الوارد','Contact seller':'اتصل بالبائع','Send message':'إرسال رسالة','Join room':'انضم إلى الغرفة','Create a room':'إنشاء غرفة','Create room':'إنشاء غرفة','Room members':'أعضاء الغرفة','Join the room':'انضم إلى الغرفة','Mark all as read':'تحديد الكل كمقروء','Profile picture':'الصورة الشخصية','Cover photo':'صورة الغلاف','Display name':'اسم العرض','Bio':'نبذة','Edit profile':'تعديل الملف الشخصي','Save profile':'حفظ الملف الشخصي','Forgot password?':'هل نسيت كلمة المرور؟','Continue to sign in':'متابعة تسجيل الدخول','Return to the homepage':'العودة إلى الصفحة الرئيسية','Loading…':'جارٍ التحميل…','Loading...':'جارٍ التحميل…','No one':'لا أحد','Nobody':'لا أحد'
    },
    pt: {
      'Home':'Início','Friends':'Amigos','Messages':'Mensagens','Rooms':'Salas','Notifications':'Notificações','Marketplace':'Marketplace','Dashboard':'Painel','Profile':'Perfil','Settings':'Configurações','Help':'Ajuda',
      'Log in':'Entrar','Log out':'Sair','Log Out':'Sair','Sign in':'Entrar','Sign up':'Cadastrar-se','Create an account':'Criar uma conta','Create account':'Criar conta','Log in securely':'Entrar com segurança','Email or username':'E-mail ou nome de usuário','Email address':'Endereço de e-mail','Username':'Nome de usuário','Password':'Senha',
      'Search':'Pesquisar','Cancel':'Cancelar','Save':'Salvar','Save changes':'Salvar alterações','Submit':'Enviar','Send':'Enviar','Message':'Mensagem','Photo':'Foto','Video':'Vídeo','Latest':'Mais recentes','All':'Todos','Public':'Público','Private':'Privado','Friends only':'Somente amigos','Everyone':'Todos','Only me':'Somente eu',
      'Category':'Categoria','Description':'Descrição','Location':'Localização','About':'Sobre','Explore':'Explorar','Back':'Voltar','See all':'Ver tudo','View all':'Ver tudo','Create a post':'Criar publicação','Publish post':'Publicar postagem','Share status':'Compartilhar status','Add status':'Adicionar status','Your feed':'Seu feed','Friend requests':'Solicitações de amizade','Sent requests':'Solicitações enviadas','My friends':'Meus amigos','Your friends':'Seus amigos','My listings':'Meus anúncios','Inbox':'Caixa de entrada','Contact seller':'Falar com vendedor','Send message':'Enviar mensagem','Join room':'Entrar na sala','Create a room':'Criar uma sala','Create room':'Criar sala','Room members':'Membros da sala','Join the room':'Entrar na sala','Mark all as read':'Marcar tudo como lido','Profile picture':'Foto do perfil','Cover photo':'Foto de capa','Display name':'Nome de exibição','Bio':'Biografia','Edit profile':'Editar perfil','Save profile':'Salvar perfil','Forgot password?':'Esqueceu a senha?','Continue to sign in':'Continuar para entrar','Return to the homepage':'Voltar à página inicial','Loading…':'Carregando…','Loading...':'Carregando…','No one':'Ninguém','Nobody':'Ninguém'
    },
    es: {
      'Home':'Inicio','Friends':'Amigos','Messages':'Mensajes','Rooms':'Salas','Notifications':'Notificaciones','Marketplace':'Mercado','Dashboard':'Panel','Profile':'Perfil','Settings':'Configuración','Help':'Ayuda',
      'Log in':'Iniciar sesión','Log out':'Cerrar sesión','Log Out':'Cerrar sesión','Sign in':'Iniciar sesión','Sign up':'Registrarse','Create an account':'Crear una cuenta','Create account':'Crear cuenta','Log in securely':'Iniciar sesión de forma segura','Email or username':'Correo o nombre de usuario','Email address':'Dirección de correo','Username':'Nombre de usuario','Password':'Contraseña',
      'Search':'Buscar','Cancel':'Cancelar','Save':'Guardar','Save changes':'Guardar cambios','Submit':'Enviar','Send':'Enviar','Message':'Mensaje','Photo':'Foto','Video':'Vídeo','Latest':'Más recientes','All':'Todos','Public':'Público','Private':'Privado','Friends only':'Solo amigos','Everyone':'Todos','Only me':'Solo yo',
      'Category':'Categoría','Description':'Descripción','Location':'Ubicación','About':'Acerca de','Explore':'Explorar','Back':'Volver','See all':'Ver todo','View all':'Ver todo','Create a post':'Crear publicación','Publish post':'Publicar','Share status':'Compartir estado','Add status':'Añadir estado','Your feed':'Tu feed','Friend requests':'Solicitudes de amistad','Sent requests':'Solicitudes enviadas','My friends':'Mis amigos','Your friends':'Tus amigos','My listings':'Mis anuncios','Inbox':'Bandeja de entrada','Contact seller':'Contactar al vendedor','Send message':'Enviar mensaje','Join room':'Unirse a la sala','Create a room':'Crear una sala','Create room':'Crear sala','Room members':'Miembros de la sala','Join the room':'Unirse a la sala','Mark all as read':'Marcar todo como leído','Profile picture':'Foto de perfil','Cover photo':'Foto de portada','Display name':'Nombre para mostrar','Bio':'Biografía','Edit profile':'Editar perfil','Save profile':'Guardar perfil','Forgot password?':'¿Olvidaste tu contraseña?','Continue to sign in':'Continuar para iniciar sesión','Return to the homepage':'Volver a la página principal','Loading…':'Cargando…','Loading...':'Cargando…','No one':'Nadie','Nobody':'Nadie'
    },
    sw: {
      'Home':'Nyumbani','Friends':'Marafiki','Messages':'Ujumbe','Rooms':'Vyumba','Notifications':'Arifa','Marketplace':'Soko','Dashboard':'Dashibodi','Profile':'Wasifu','Settings':'Mipangilio','Help':'Msaada',
      'Log in':'Ingia','Log out':'Toka','Log Out':'Toka','Sign in':'Ingia','Sign up':'Jisajili','Create an account':'Fungua akaunti','Create account':'Fungua akaunti','Log in securely':'Ingia kwa usalama','Email or username':'Barua pepe au jina la mtumiaji','Email address':'Anwani ya barua pepe','Username':'Jina la mtumiaji','Password':'Nenosiri',
      'Search':'Tafuta','Cancel':'Ghairi','Save':'Hifadhi','Save changes':'Hifadhi mabadiliko','Submit':'Wasilisha','Send':'Tuma','Message':'Ujumbe','Photo':'Picha','Video':'Video','Latest':'Vipya zaidi','All':'Zote','Public':'Wazi kwa wote','Private':'Faragha','Friends only':'Marafiki pekee','Everyone':'Kila mtu','Only me':'Mimi pekee',
      'Category':'Kategoria','Description':'Maelezo','Location':'Mahali','About':'Kuhusu','Explore':'Gundua','Back':'Rudi','See all':'Tazama zote','View all':'Tazama zote','Create a post':'Tengeneza chapisho','Publish post':'Chapisha','Share status':'Shiriki hali','Add status':'Ongeza hali','Your feed':'Mtiririko wako','Friend requests':'Maombi ya urafiki','Sent requests':'Maombi yaliyotumwa','My friends':'Marafiki wangu','Your friends':'Marafiki zako','My listings':'Matangazo yangu','Inbox':'Kikasha','Contact seller':'Wasiliana na muuzaji','Send message':'Tuma ujumbe','Join room':'Jiunge na chumba','Create a room':'Tengeneza chumba','Create room':'Tengeneza chumba','Room members':'Wanachama wa chumba','Join the room':'Jiunge na chumba','Mark all as read':'Weka zote kuwa zimesomwa','Profile picture':'Picha ya wasifu','Cover photo':'Picha ya jalada','Display name':'Jina la kuonyesha','Bio':'Wasifu mfupi','Edit profile':'Hariri wasifu','Save profile':'Hifadhi wasifu','Forgot password?':'Umesahau nenosiri?','Continue to sign in':'Endelea kuingia','Return to the homepage':'Rudi ukurasa wa mwanzo','Loading…':'Inapakia…','Loading...':'Inapakia…','No one':'Hakuna mtu','Nobody':'Hakuna mtu'
    },
    pcm: {
      'Home':'Home','Friends':'Pipu wey be your padi','Messages':'Messages','Rooms':'Community rooms','Notifications':'Notifications','Marketplace':'Market','Dashboard':'Dashboard','Profile':'Profile','Settings':'Settings','Help':'Help',
      'Log in':'Enter','Log out':'Comot','Log Out':'Comot','Sign in':'Enter','Sign up':'Register','Create an account':'Create account','Create account':'Create account','Log in securely':'Enter safely','Email or username':'Email or username','Email address':'Email address','Username':'Username','Password':'Password',
      'Search':'Find am','Cancel':'Cancel am','Save':'Save am','Save changes':'Save changes','Submit':'Send am','Send':'Send am','Message':'Message','Photo':'Photo','Video':'Video','Latest':'Wetin new','All':'All','Public':'Everybody fit see am','Private':'Private','Friends only':'Na your padi dem only','Everyone':'Everybody','Only me':'Na me only',
      'Category':'Category','Description':'Description','Location':'Location','About':'About','Explore':'Check am','Back':'Go back','See all':'See all','View all':'View all','Create a post':'Create post','Publish post':'Post am','Share status':'Share status','Add status':'Add status','Your feed':'Your feed','Friend requests':'Friend requests','Sent requests':'Requests wey you send','My friends':'My friends','Your friends':'Your friends','My listings':'My things for sale','Inbox':'Inbox','Contact seller':'Contact seller','Send message':'Send message','Join room':'Join room','Create a room':'Create room','Create room':'Create room','Room members':'Room members','Join the room':'Join the room','Mark all as read':'Mark everything as read','Profile picture':'Profile picture','Cover photo':'Cover photo','Display name':'Display name','Bio':'About you','Edit profile':'Edit profile','Save profile':'Save profile','Forgot password?':'You don forget password?','Continue to sign in':'Continue to enter','Return to the homepage':'Go back to homepage','Loading…':'E dey load…','Loading...':'E dey load…','No one':'Nobody','Nobody':'Nobody'
    },
    ko: {
      'Home':'홈','Friends':'친구','Messages':'메시지','Rooms':'채팅방','Notifications':'알림','Marketplace':'마켓플레이스','Dashboard':'대시보드','Profile':'프로필','Settings':'설정','Help':'도움말',
      'Log in':'로그인','Log out':'로그아웃','Log Out':'로그아웃','Sign in':'로그인','Sign up':'가입하기','Create an account':'계정 만들기','Create account':'계정 만들기','Log in securely':'안전하게 로그인','Email or username':'이메일 또는 사용자 이름','Email address':'이메일 주소','Username':'사용자 이름','Password':'비밀번호',
      'Search':'검색','Cancel':'취소','Save':'저장','Save changes':'변경 사항 저장','Submit':'제출','Send':'보내기','Message':'메시지','Photo':'사진','Video':'동영상','Latest':'최신','All':'전체','Public':'공개','Private':'비공개','Friends only':'친구만','Everyone':'모두','Only me':'나만',
      'Category':'카테고리','Description':'설명','Location':'위치','About':'소개','Explore':'탐색','Back':'뒤로','See all':'모두 보기','View all':'모두 보기','Create a post':'게시물 만들기','Publish post':'게시물 게시','Share status':'상태 공유','Add status':'상태 추가','Your feed':'내 피드','Friend requests':'친구 요청','Sent requests':'보낸 요청','My friends':'내 친구','Your friends':'내 친구','My listings':'내 등록 상품','Inbox':'받은 편지함','Contact seller':'판매자에게 연락','Send message':'메시지 보내기','Join room':'채팅방 참여','Create a room':'채팅방 만들기','Create room':'채팅방 만들기','Room members':'채팅방 회원','Join the room':'채팅방 참여','Mark all as read':'모두 읽음으로 표시','Profile picture':'프로필 사진','Cover photo':'커버 사진','Display name':'표시 이름','Bio':'소개','Edit profile':'프로필 수정','Save profile':'프로필 저장','Forgot password?':'비밀번호를 잊으셨나요?','Continue to sign in':'로그인 계속하기','Return to the homepage':'홈페이지로 돌아가기','Loading…':'불러오는 중…','Loading...':'불러오는 중…','No one':'없음','Nobody':'없음'
    },
    'zh-CN': {
      'Home':'首页','Friends':'好友','Messages':'消息','Rooms':'聊天室','Notifications':'通知','Marketplace':'市场','Dashboard':'控制面板','Profile':'个人资料','Settings':'设置','Help':'帮助',
      'Log in':'登录','Log out':'退出登录','Log Out':'退出登录','Sign in':'登录','Sign up':'注册','Create an account':'创建账号','Create account':'创建账号','Log in securely':'安全登录','Email or username':'邮箱或用户名','Email address':'电子邮箱地址','Username':'用户名','Password':'密码',
      'Search':'搜索','Cancel':'取消','Save':'保存','Save changes':'保存更改','Submit':'提交','Send':'发送','Message':'消息','Photo':'照片','Video':'视频','Latest':'最新','All':'全部','Public':'公开','Private':'私密','Friends only':'仅好友','Everyone':'所有人','Only me':'仅自己',
      'Category':'类别','Description':'描述','Location':'位置','About':'关于','Explore':'探索','Back':'返回','See all':'查看全部','View all':'查看全部','Create a post':'创建动态','Publish post':'发布动态','Share status':'分享状态','Add status':'添加状态','Your feed':'你的动态','Friend requests':'好友请求','Sent requests':'已发送请求','My friends':'我的好友','Your friends':'你的好友','My listings':'我的商品','Inbox':'收件箱','Contact seller':'联系卖家','Send message':'发送消息','Join room':'加入聊天室','Create a room':'创建聊天室','Create room':'创建聊天室','Room members':'聊天室成员','Join the room':'加入聊天室','Mark all as read':'全部标为已读','Profile picture':'头像','Cover photo':'封面照片','Display name':'显示名称','Bio':'个人简介','Edit profile':'编辑个人资料','Save profile':'保存个人资料','Forgot password?':'忘记密码？','Continue to sign in':'继续登录','Return to the homepage':'返回首页','Loading…':'正在加载…','Loading...':'正在加载…','No one':'没有人','Nobody':'没有人'
    }
  };


  const EXTRA = {
    yo: {
      'WELCOME BACK':'Ẹ kú àbọ̀','JOIN THE COMMUNITY':'DARAPỌ̀ MỌ́ ÀWỌN ÈNÌYÀN','Log in to Frnxup':'Wọlé sí Frnxup','Create your account':'Ṣẹ̀dá àkọọ́lẹ̀ rẹ','Sign in with your registered email address or username.':'Wọlé pẹ̀lú ímeèlì tàbí orúkọ aṣàmúlò tí o fi forúkọ sílẹ̀.','Set up your Frnxup account to connect, express and rise.':'Ṣètò àkọọ́lẹ̀ Frnxup rẹ láti bá ènìyàn sọ̀rọ̀, láti fi ara rẹ hàn àti láti gbèrú.','Don\'t have a Frnxup account?':'Ṣé o kò ní àkọọ́lẹ̀ Frnxup?','Already have a Frnxup account?':'Ṣé o ti ní àkọọ́lẹ̀ Frnxup tẹ́lẹ̀?','Only members with a valid sign-in session can enter Frnxup.':'Àwọn ọmọ ẹgbẹ́ tí wọ́n bá ti wọlé ní ààbò nìkan ló lè wọ Frnxup.','Your account is protected by secure sign-in and session checks.':'A ń dáàbò bo àkọọ́lẹ̀ rẹ pẹ̀lú ìwọlé ààbò àti àyẹ̀wò ìpàdé.','Use a unique password with at least 8 characters. Keep your login details private.':'Lo ọ̀rọ̀ aṣínà pàtàkì tó ní ó kéré tán àmì mẹ́jọ. Pa àlàyé ìwọlé rẹ mọ́ fúnra rẹ.','letters, numbers and underscore':'Àwọn lẹ́tà, nọ́ńbà àti àmì ìsàlẹ̀','At least 8 characters':'Ó kéré tán àmì mẹ́jọ','Communities & rooms':'Àwọn àwùjọ àti yàrá','Find people':'Wá àwọn ènìyàn','Saved posts':'Àwọn ìtẹ̀jáde tí a fi pamọ́','Privacy & security':'Ìpamọ́ àti ààbò','Help and support':'Ìrànlọ́wọ́ àti àtìlẹ́yìn','Switch appearance':'Yí ìrísí padà'
    },
    ha: {
      'WELCOME BACK':'BARKA DA ZUWA','JOIN THE COMMUNITY':'SHIGA CIKIN AL’UMMA','Log in to Frnxup':'Shiga Frnxup','Create your account':'Ƙirƙiri asusunka','Sign in with your registered email address or username.':'Shiga da adireshin imel ko sunan mai amfani da ka yi rajista da shi.','Set up your Frnxup account to connect, express and rise.':'Kafa asusun Frnxup don haɗuwa da mutane, bayyana kanka da ci gaba.','Don\'t have a Frnxup account?':'Ba ka da asusun Frnxup?','Already have a Frnxup account?':'Kana da asusun Frnxup tuni?','Only members with a valid sign-in session can enter Frnxup.':'Mambobi masu ingantaccen zaman shiga ne kawai za su iya shiga Frnxup.','Your account is protected by secure sign-in and session checks.':'Ana kare asusunka ta hanyar shiga mai tsaro da tantance zaman shiga.','Use a unique password with at least 8 characters. Keep your login details private.':'Yi amfani da kalmar sirri ta musamman mai aƙalla haruffa 8. Ka kiyaye bayanan shigarka.','letters, numbers and underscore':'Haruffa, lambobi da alamar layin ƙasa','At least 8 characters':'Aƙalla haruffa 8','Communities & rooms':'Al’umma da dakuna','Find people':'Nemo mutane','Saved posts':'Rubuce-rubucen da aka adana','Privacy & security':'Sirri da tsaro','Help and support':'Taimako da tallafi','Switch appearance':'Canza bayyanar shafi'
    },
    ig: {
      'WELCOME BACK':'NDAA NỌỌ Ọ BỤGHACHI','JOIN THE COMMUNITY':'SONYE NA ỌHA','Log in to Frnxup':'Banye na Frnxup','Create your account':'Mepụta akaụntụ gị','Sign in with your registered email address or username.':'Jiri email ma ọ bụ aha njirimara i ji debanye aha banye.','Set up your Frnxup account to connect, express and rise.':'Hazie akaụntụ Frnxup gị ka gị na ndị ọzọ jikọọ, gosipụta onwe gị ma tolite.','Don\'t have a Frnxup account?':'Ị nweghị akaụntụ Frnxup?','Already have a Frnxup account?':'Ị nwere akaụntụ Frnxup?','Only members with a valid sign-in session can enter Frnxup.':'Ọ bụ naanị ndị otu batara n’ụzọ ziri ezi nwere ike ịbanye na Frnxup.','Your account is protected by secure sign-in and session checks.':'A na-echekwa akaụntụ gị site na nbanye nchekwa na nyocha nnọkọ.','Use a unique password with at least 8 characters. Keep your login details private.':'Jiri okwuntughe pụrụ iche nwere opekata mpe mkpụrụedemede 8. Debe ozi nbanye gị na nzuzo.','letters, numbers and underscore':'Mkpụrụedemede, ọnụọgụ na akara n’okpuru','At least 8 characters':'Opekata mpe mkpụrụedemede 8','Communities & rooms':'Obodo na ụlọ mkparịta ụka','Find people':'Chọọ ndị mmadụ','Saved posts':'Mbipụta echekwara','Privacy & security':'Nzuzo na nchekwa','Help and support':'Enyemaka na nkwado','Switch appearance':'Gbanwee ọdịdị'
    },
    fr: {
      'WELCOME BACK':'BON RETOUR','JOIN THE COMMUNITY':'REJOIGNEZ LA COMMUNAUTÉ','Log in to Frnxup':'Se connecter à Frnxup','Create your account':'Créez votre compte','Sign in with your registered email address or username.':'Connectez-vous avec votre adresse e-mail ou votre nom d’utilisateur enregistré.','Set up your Frnxup account to connect, express and rise.':'Configurez votre compte Frnxup pour échanger, vous exprimer et progresser.','Don\'t have a Frnxup account?':'Vous n’avez pas de compte Frnxup ?','Already have a Frnxup account?':'Vous avez déjà un compte Frnxup ?','Only members with a valid sign-in session can enter Frnxup.':'Seuls les membres disposant d’une session valide peuvent accéder à Frnxup.','Your account is protected by secure sign-in and session checks.':'Votre compte est protégé par une connexion sécurisée et des contrôles de session.','Use a unique password with at least 8 characters. Keep your login details private.':'Utilisez un mot de passe unique d’au moins 8 caractères. Gardez vos identifiants confidentiels.','letters, numbers and underscore':'Lettres, chiffres et trait de soulignement','At least 8 characters':'Au moins 8 caractères','Communities & rooms':'Communautés et salons','Find people':'Trouver des personnes','Saved posts':'Publications enregistrées','Privacy & security':'Confidentialité et sécurité','Help and support':'Aide et assistance','Switch appearance':'Changer l’apparence'
    },
    ar: {
      'WELCOME BACK':'مرحباً بعودتك','JOIN THE COMMUNITY':'انضم إلى المجتمع','Log in to Frnxup':'تسجيل الدخول إلى Frnxup','Create your account':'أنشئ حسابك','Sign in with your registered email address or username.':'سجّل الدخول باستخدام بريدك الإلكتروني المسجل أو اسم المستخدم.','Set up your Frnxup account to connect, express and rise.':'أنشئ حساب Frnxup للتواصل والتعبير عن نفسك والتقدم.','Don\'t have a Frnxup account?':'ليس لديك حساب Frnxup؟','Already have a Frnxup account?':'هل لديك حساب Frnxup بالفعل؟','Only members with a valid sign-in session can enter Frnxup.':'يمكن للأعضاء الذين لديهم جلسة دخول صالحة فقط الدخول إلى Frnxup.','Your account is protected by secure sign-in and session checks.':'حسابك محمي بتسجيل دخول آمن وفحوصات الجلسة.','Use a unique password with at least 8 characters. Keep your login details private.':'استخدم كلمة مرور فريدة لا تقل عن 8 أحرف. حافظ على سرية بيانات الدخول.','letters, numbers and underscore':'حروف وأرقام وشرطة سفلية','At least 8 characters':'8 أحرف على الأقل','Communities & rooms':'المجتمعات والغرف','Find people':'البحث عن أشخاص','Saved posts':'المنشورات المحفوظة','Privacy & security':'الخصوصية والأمان','Help and support':'المساعدة والدعم','Switch appearance':'تغيير المظهر'
    },
    pt: {
      'WELCOME BACK':'BEM-VINDO DE VOLTA','JOIN THE COMMUNITY':'JUNTE-SE À COMUNIDADE','Log in to Frnxup':'Entrar no Frnxup','Create your account':'Crie sua conta','Sign in with your registered email address or username.':'Entre com o endereço de e-mail ou nome de usuário cadastrado.','Set up your Frnxup account to connect, express and rise.':'Configure sua conta Frnxup para se conectar, expressar e crescer.','Don\'t have a Frnxup account?':'Ainda não tem uma conta Frnxup?','Already have a Frnxup account?':'Já tem uma conta Frnxup?','Only members with a valid sign-in session can enter Frnxup.':'Somente membros com uma sessão de login válida podem entrar no Frnxup.','Your account is protected by secure sign-in and session checks.':'Sua conta é protegida por login seguro e verificações de sessão.','Use a unique password with at least 8 characters. Keep your login details private.':'Use uma senha exclusiva com pelo menos 8 caracteres. Mantenha seus dados de acesso em sigilo.','letters, numbers and underscore':'Letras, números e sublinhado','At least 8 characters':'Pelo menos 8 caracteres','Communities & rooms':'Comunidades e salas','Find people':'Encontrar pessoas','Saved posts':'Publicações salvas','Privacy & security':'Privacidade e segurança','Help and support':'Ajuda e suporte','Switch appearance':'Alterar aparência'
    },
    es: {
      'WELCOME BACK':'QUÉ BUENO TENERTE DE VUELTA','JOIN THE COMMUNITY':'ÚNETE A LA COMUNIDAD','Log in to Frnxup':'Iniciar sesión en Frnxup','Create your account':'Crea tu cuenta','Sign in with your registered email address or username.':'Inicia sesión con tu correo electrónico o nombre de usuario registrado.','Set up your Frnxup account to connect, express and rise.':'Configura tu cuenta de Frnxup para conectar, expresarte y crecer.','Don\'t have a Frnxup account?':'¿No tienes una cuenta de Frnxup?','Already have a Frnxup account?':'¿Ya tienes una cuenta de Frnxup?','Only members with a valid sign-in session can enter Frnxup.':'Solo los miembros con una sesión válida pueden entrar en Frnxup.','Your account is protected by secure sign-in and session checks.':'Tu cuenta está protegida mediante inicio de sesión seguro y comprobaciones de sesión.','Use a unique password with at least 8 characters. Keep your login details private.':'Usa una contraseña única de al menos 8 caracteres. Mantén tus datos de acceso en privado.','letters, numbers and underscore':'Letras, números y guion bajo','At least 8 characters':'Al menos 8 caracteres','Communities & rooms':'Comunidades y salas','Find people':'Buscar personas','Saved posts':'Publicaciones guardadas','Privacy & security':'Privacidad y seguridad','Help and support':'Ayuda y soporte','Switch appearance':'Cambiar apariencia'
    },
    sw: {
      'WELCOME BACK':'KARIBU TENA','JOIN THE COMMUNITY':'JIUNGE NA JAMII','Log in to Frnxup':'Ingia Frnxup','Create your account':'Fungua akaunti yako','Sign in with your registered email address or username.':'Ingia kwa kutumia barua pepe au jina la mtumiaji ulilosajili.','Set up your Frnxup account to connect, express and rise.':'Sanidi akaunti yako ya Frnxup ili kuungana, kujieleza na kukua.','Don\'t have a Frnxup account?':'Huna akaunti ya Frnxup?','Already have a Frnxup account?':'Tayari una akaunti ya Frnxup?','Only members with a valid sign-in session can enter Frnxup.':'Wanachama walio na kipindi halali cha kuingia pekee wanaweza kuingia Frnxup.','Your account is protected by secure sign-in and session checks.':'Akaunti yako inalindwa kwa kuingia salama na ukaguzi wa kipindi.','Use a unique password with at least 8 characters. Keep your login details private.':'Tumia nenosiri la kipekee lenye angalau vibambo 8. Weka taarifa zako za kuingia kuwa siri.','letters, numbers and underscore':'Herufi, nambari na mstari wa chini','At least 8 characters':'Angalau vibambo 8','Communities & rooms':'Jamii na vyumba','Find people':'Tafuta watu','Saved posts':'Machapisho yaliyohifadhiwa','Privacy & security':'Faragha na usalama','Help and support':'Msaada na usaidizi','Switch appearance':'Badilisha mwonekano'
    },
    pcm: {
      'WELCOME BACK':'YOU DON COME BACK','JOIN THE COMMUNITY':'JOIN THE COMMUNITY','Log in to Frnxup':'Enter Frnxup','Create your account':'Create your account','Sign in with your registered email address or username.':'Use the email or username wey you register with take enter.','Set up your Frnxup account to connect, express and rise.':'Set your Frnxup account make you connect, express yourself and grow.','Don\'t have a Frnxup account?':'You never get Frnxup account?','Already have a Frnxup account?':'You don get Frnxup account before?','Only members with a valid sign-in session can enter Frnxup.':'Na members wey don enter with correct session fit enter Frnxup.','Your account is protected by secure sign-in and session checks.':'Secure login and session checks dey protect your account.','Use a unique password with at least 8 characters. Keep your login details private.':'Use special password wey get at least 8 characters. No share your login details.','letters, numbers and underscore':'Letters, numbers and underscore','At least 8 characters':'At least 8 characters','Communities & rooms':'Communities and rooms','Find people':'Find people','Saved posts':'Posts wey you save','Privacy & security':'Privacy and security','Help and support':'Help and support','Switch appearance':'Change how e look'
    },
    ko: {
      'WELCOME BACK':'다시 오신 것을 환영합니다','JOIN THE COMMUNITY':'커뮤니티에 참여하세요','Log in to Frnxup':'Frnxup 로그인','Create your account':'계정 만들기','Sign in with your registered email address or username.':'등록한 이메일 주소 또는 사용자 이름으로 로그인하세요.','Set up your Frnxup account to connect, express and rise.':'Frnxup 계정을 설정하고 소통하며 자신을 표현하고 성장하세요.','Don\'t have a Frnxup account?':'Frnxup 계정이 없으신가요?','Already have a Frnxup account?':'이미 Frnxup 계정이 있으신가요?','Only members with a valid sign-in session can enter Frnxup.':'유효한 로그인 세션이 있는 회원만 Frnxup에 접속할 수 있습니다.','Your account is protected by secure sign-in and session checks.':'안전한 로그인과 세션 확인으로 계정을 보호합니다.','Use a unique password with at least 8 characters. Keep your login details private.':'8자 이상의 고유한 비밀번호를 사용하고 로그인 정보를 안전하게 보관하세요.','letters, numbers and underscore':'영문자, 숫자 및 밑줄','At least 8 characters':'8자 이상','Communities & rooms':'커뮤니티 및 채팅방','Find people':'사람 찾기','Saved posts':'저장된 게시물','Privacy & security':'개인정보 및 보안','Help and support':'도움말 및 지원','Switch appearance':'화면 모드 변경'
    },
    'zh-CN': {
      'WELCOME BACK':'欢迎回来','JOIN THE COMMUNITY':'加入社区','Log in to Frnxup':'登录 Frnxup','Create your account':'创建你的账号','Sign in with your registered email address or username.':'使用你注册的电子邮箱或用户名登录。','Set up your Frnxup account to connect, express and rise.':'设置 Frnxup 账号，与他人联系、表达自己并不断成长。','Don\'t have a Frnxup account?':'还没有 Frnxup 账号？','Already have a Frnxup account?':'已经拥有 Frnxup 账号？','Only members with a valid sign-in session can enter Frnxup.':'只有拥有有效登录会话的会员才能进入 Frnxup。','Your account is protected by secure sign-in and session checks.':'你的账号受到安全登录和会话检查的保护。','Use a unique password with at least 8 characters. Keep your login details private.':'请使用至少 8 位的专属密码，并妥善保管登录信息。','letters, numbers and underscore':'字母、数字和下划线','At least 8 characters':'至少 8 个字符','Communities & rooms':'社区和聊天室','Find people':'寻找用户','Saved posts':'已保存的动态','Privacy & security':'隐私与安全','Help and support':'帮助与支持','Switch appearance':'切换外观'
    }
  };
  Object.entries(EXTRA).forEach(([language, entries]) => Object.assign(D[language], entries));

  const byCode = Object.fromEntries(LANGUAGES.map(([code, name]) => [code, name]));
  const isAdmin = /^\/Admin(?:\/|$)/i.test(location.pathname);
  if (isAdmin || document.documentElement.hasAttribute('data-no-language')) return;

  const textBase = new WeakMap();
  const textLast = new WeakMap();
  const attrBase = new WeakMap();
  const attrLast = new WeakMap();
  const skipSelector = 'script,style,noscript,svg,code,pre,textarea,[contenteditable="true"],[data-no-translate],.fx-language-wrap,.post-card,.post-content,.comment-item,.comment-body,.chat-message,.message-bubble,.user-generated,.market-card,.listing-card,.profile-bio,.fx-profile-copy';
  let activeLanguage = 'en';
  let observer = null;

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const translate = (value, lang = activeLanguage) => {
    const key = clean(value);
    return D[lang]?.[key] || key;
  };
  const isSkipped = node => !!node.parentElement?.closest(skipSelector);

  function translateTextNode(node) {
    if (!node || isSkipped(node)) return;
    const current = node.nodeValue || '';
    const last = textLast.get(node);
    let base = textBase.get(node);
    if (base === undefined || current !== last) {
      base = current;
      textBase.set(node, base);
    }
    const key = clean(base);
    const leading = (base.match(/^\s*/) || [''])[0];
    const trailing = (base.match(/\s*$/) || [''])[0];
    const result = D[activeLanguage]?.[key] ? `${leading}${D[activeLanguage][key]}${trailing}` : base;
    if (current !== result) node.nodeValue = result;
    textLast.set(node, result);
  }

  function translateAttributes(element) {
    if (!(element instanceof Element) || element.matches(skipSelector)) return;
    const names = ['placeholder', 'title', 'aria-label'];
    if (element instanceof HTMLInputElement && ['button','submit','reset'].includes(element.type)) names.push('value');
    for (const name of names) {
      if (!element.hasAttribute(name)) continue;
      const current = element.getAttribute(name) || '';
      let state = attrBase.get(element);
      if (!state) { state = {}; attrBase.set(element, state); }
      let lastState = attrLast.get(element);
      if (!lastState) { lastState = {}; attrLast.set(element, lastState); }
      if (state[name] === undefined || current !== lastState[name]) state[name] = current;
      const key = clean(state[name]);
      const result = D[activeLanguage]?.[key] || state[name];
      if (current !== result) element.setAttribute(name, result);
      lastState[name] = result;
    }
  }

  function translateSubtree(root = document) {
    if (!root) return;
    if (root.nodeType === Node.ELEMENT_NODE) translateAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) translateTextNode(node);
    if (root.querySelectorAll) root.querySelectorAll('*').forEach(translateAttributes);
  }

  function languageLabel(code) { return byCode[code] || 'English'; }
  function setLanguage(code, persist = true) {
    activeLanguage = LANGUAGES.some(([id]) => id === code) ? code : 'en';
    document.documentElement.lang = activeLanguage === 'zh-CN' ? 'zh-CN' : activeLanguage;
    document.documentElement.dir = activeLanguage === 'ar' ? 'rtl' : 'ltr';
    try { localStorage.setItem('frnxup_language', activeLanguage); } catch (_) {}
    document.querySelectorAll('.fx-language-select').forEach(select => { select.value = activeLanguage; });
    translateSubtree(document.body);
    if (persist && window.FX?.client) {
      (async () => {
        try {
          const { data } = await FX.client.auth.getSession();
          const user = data?.session?.user;
          if (user) await FX.client.auth.updateUser({ data: { ...(user.user_metadata || {}), preferred_language: activeLanguage } });
        } catch (_) { /* local preference remains saved when cloud sync is unavailable */ }
      })();
    }
  }

  function createSelector() {
    if (document.querySelector('.fx-language-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'fx-language-wrap';
    wrap.setAttribute('data-no-translate', '');
    const label = document.createElement('label');
    label.className = 'fx-language-label';
    label.textContent = '🌐';
    label.setAttribute('for', 'fx-language-select');
    label.setAttribute('aria-label', 'Language');
    const select = document.createElement('select');
    select.id = 'fx-language-select';
    select.className = 'fx-language-select';
    select.setAttribute('aria-label', 'Language');
    LANGUAGES.forEach(([code, name]) => {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = name;
      select.append(option);
    });
    select.value = activeLanguage;
    select.addEventListener('change', () => setLanguage(select.value, true));
    wrap.append(label, select);

    const visible = selector => selector && getComputedStyle(selector).display !== 'none';
    const brandHeader = document.querySelector('.brand-header');
    const topbar = document.querySelector('.fx-topbar');
    if (visible(brandHeader)) {
      const menuButton = brandHeader.querySelector('.menu-button');
      if (menuButton) brandHeader.insertBefore(wrap, menuButton);
      else brandHeader.append(wrap);
    } else if (visible(topbar)) {
      const actions = topbar.querySelector('.fx-top-actions');
      if (actions) actions.prepend(wrap);
      else topbar.append(wrap);
    } else {
      wrap.classList.add('fx-language-floating');
      document.body.append(wrap);
    }
  }

  function addStyles() {
    if (document.getElementById('fx-language-styles')) return;
    const style = document.createElement('style');
    style.id = 'fx-language-styles';
    style.textContent = `
      .fx-language-wrap{display:flex;align-items:center;gap:6px;flex:0 0 auto;min-width:0;color:var(--text,#183642);font:600 12px system-ui,sans-serif}
      .fx-language-label{font-size:15px;line-height:1;cursor:pointer}
      .fx-language-select{max-width:145px;min-width:112px;height:36px;padding:0 25px 0 10px;border:1px solid var(--line,#dce8eb);border-radius:20px;background:var(--surface,#fff);color:var(--text,#183642);font:600 11px system-ui,sans-serif;outline:none;cursor:pointer}
      .fx-language-select:focus{border-color:#168eaa;box-shadow:0 0 0 3px #168eaa20}
      .fx-language-floating{position:fixed;top:12px;right:12px;z-index:10020;padding:6px 9px;border:1px solid #dce8eb;border-radius:24px;background:#fff;box-shadow:0 5px 20px #18364218;color:#183642}
      .fx-language-floating .fx-language-select{border:0;box-shadow:none;max-width:160px}
      .auth-screen .fx-language-floating{top:12px;right:12px}
      .fx-topbar .fx-language-wrap{margin-left:auto}
      @media(max-width:520px){.brand-header .fx-language-wrap{gap:3px;margin-left:auto;margin-right:7px}.brand-header .fx-language-select{min-width:94px;max-width:118px;padding-left:8px;font-size:10px;height:33px}.brand-header .fx-language-label{font-size:13px}.fx-language-floating{top:auto;bottom:12px;right:10px}.auth-screen .fx-language-floating{top:10px;bottom:auto}}
      html[dir="rtl"] .fx-language-wrap{direction:rtl}
    `;
    document.head.append(style);
  }

  async function chooseInitialLanguage() {
    let stored = null;
    try { stored = localStorage.getItem('frnxup_language'); } catch (_) {}
    if (stored && byCode[stored]) return stored;
    try {
      const session = await window.FX?.client?.auth?.getSession();
      const preferred = session?.data?.session?.user?.user_metadata?.preferred_language;
      if (preferred && byCode[preferred]) return preferred;
    } catch (_) {}
    return 'en';
  }

  function startObserver() {
    if (observer || !document.body) return;
    observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'characterData') translateTextNode(record.target);
        if (record.type === 'attributes') translateAttributes(record.target);
        record.addedNodes?.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) translateSubtree(node);
          else if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder','title','aria-label','value'] });
  }

  async function start() {
    addStyles();
    activeLanguage = await chooseInitialLanguage();
    createSelector();
    setLanguage(activeLanguage, false);
    startObserver();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
