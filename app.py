import os
import time
import glob
import json
import logging
import subprocess
import shutil
import stat
import sqlite3
from datetime import datetime, timedelta
from threading import Thread, Lock
import pandas as pd
from flask import Flask, jsonify, send_from_directory, request
from dotenv import load_dotenv

# Carrega as variáveis de ambiente do arquivo .env
load_dotenv()

# =====================================================================
#             CONFIGURAÇÕES GERAIS E BANCO DE DADOS
# =====================================================================

LOCAL_PROJETO_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(LOCAL_PROJETO_DIR, "banco_dados.db")

def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS fichas_manutencao (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                veiculo TEXT NOT NULL,
                data_abertura TEXT NOT NULL,
                hora_abertura TEXT NOT NULL,
                data_fechamento TEXT,
                hora_fechamento TEXT,
                UNIQUE(veiculo, data_abertura, hora_abertura)
            )
        ''')
        conn.commit()

init_db()

# Selenium Imports
from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# Inicializa o Flask
app = Flask(__name__, static_folder='.', template_folder='.')

# Configurações de pastas e credenciais
user_home = os.path.expanduser("~")
DOWNLOAD_DIR = os.path.join(user_home, "OneDrive - Nossa Senhora do Ó Participações S.A", "Status em Python")
GECKODRIVER_PATH = os.path.join(LOCAL_PROJETO_DIR, "geckodriver.exe")

USUARIO_FLITS = os.getenv("USUARIO_FLITS", "")
SENHA_FLITS = os.getenv("SENHA_FLITS", "")
URL_FLITS = "https://flits.cittati.com.br/login"

# Lock de controle de execução única
executando_lock = Lock()

# Mapeamento de meses em português
MESES_PT_REV = {
    "Janeiro": "01", "Fevereiro": "02", "Março": "03", "Abril": "04",
    "Maio": "05", "Junho": "06", "Julho": "07", "Agosto": "08",
    "Setembro": "09", "Outubro": "10", "Novembro": "11", "Dezembro": "12"
}
MESES_PT = {int(v): k for k, v in MESES_PT_REV.items()}

# =====================================================================
#             FUNÇÕES AUXILIARES E LIMPEZA DE TELA
# =====================================================================

def buscar_caminho_firefox():
    caminhos_busca = [
        os.path.join(os.environ.get('USERPROFILE', ''), r"AppData\Local\Mozilla Firefox\firefox.exe"),
        r"C:\Program Files\Mozilla Firefox\firefox.exe",
        r"C:\Program Files (x86)\Mozilla Firefox\firefox.exe",
        os.path.join(os.environ.get('LOCALAPPDATA', ''), r"Mozilla Firefox\firefox.exe")
    ]
    for caminho in caminhos_busca:
        if os.path.exists(caminho): return caminho
    return None

def limpar_bloqueios_tela(driver):
    botoes_alvo = ["Entendido", "Aceite", "Aceitar", "Ok", "Fechar"]
    for texto in botoes_alvo:
        try:
            xpath = f"//button[.//span[contains(text(), '{texto}')]] | //button[contains(text(), '{texto}')]"
            elementos = driver.find_elements(By.XPATH, xpath)
            for el in elementos:
                if el.is_displayed():
                    driver.execute_script("arguments[0].click();", el)
                    print(f"     [Limpeza] Pop-up '{texto}' fechado.")
                    time.sleep(1)
        except: pass
    try:
        driver.execute_script("document.querySelectorAll('.ant-modal-wrap, .ant-modal-mask').forEach(el => el.style.display = 'none');")
    except: pass

def aguardar_conclusao_download(pasta_download, timeout=15):
    fim = time.time() + timeout
    while time.time() < fim:
        arquivos_temp = glob.glob(os.path.join(pasta_download, "*.part")) + glob.glob(os.path.join(pasta_download, "*.crdownload"))
        if not arquivos_temp:
            return True
        time.sleep(0.5)
    return False

def enviar_para_github(nome_dados_dia_local):
    try:
        print("[Git] Sincronizando com GitHub...", flush=True)
        # Se houver algum rebase travado por travamento anterior, aborta
        subprocess.run(["git", "rebase", "--abort"], cwd=LOCAL_PROJETO_DIR, check=False)

        # 1. Garante que estamos na branch main
        subprocess.run(["git", "checkout", "main"], cwd=LOCAL_PROJETO_DIR, check=False)

        # 2. Puxa eventuais fichas enviadas da Web usando merge seguro (sem travar em rebase)
        subprocess.run(["git", "pull", "--no-rebase", "origin", "main"], cwd=LOCAL_PROJETO_DIR, check=False)

        # 3. Adiciona as alterações locais
        subprocess.run(["git", "add", "-A"], cwd=LOCAL_PROJETO_DIR, check=True)
        
        # 4. Comita se houver alterações
        status = subprocess.run(["git", "status", "--porcelain"], cwd=LOCAL_PROJETO_DIR, capture_output=True, text=True)
        if status.stdout.strip():
            subprocess.run(["git", "commit", "-m", f"Automacao Flits: {datetime.now().strftime('%d/%m %H:%M')}"], cwd=LOCAL_PROJETO_DIR, check=True)

        # 5. Envia para o GitHub
        subprocess.run(["git", "push", "origin", "main"], cwd=LOCAL_PROJETO_DIR, check=True)
        print("[Git] Sincronização automática OK.", flush=True)
    except Exception as e: 
        print(f"[Git - Erro] {e}", flush=True)

# =====================================================================
#                 ROTINA DE AUTOMAÇÃO FLITS (FLUXO LINEAR)
# =====================================================================

def iniciar_automacao_flits():
    empresas = [
        "Cidade de Caieiras - Municipal Caieiras",
        "Cidade de Caieiras - Municipal Franco da Rocha",
        "Urubupungá",
        "Urubupungá Municipal Cajamar",
        "Urubupungá Municipal Osasco",
        "Urubupungá Municipal Santana",
        "Viação Cidade Caieiras"
    ]
    driver = None

    try:
        # Configurações do Firefox (Modo Oculto / Headless Ativado)
        options = Options()
        options.add_argument("--headless")
        options.add_argument("--width=1920")
        options.add_argument("--height=1080")
        caminho_f = buscar_caminho_firefox()
        if caminho_f: options.binary_location = caminho_f
        options.set_preference("browser.download.folderList", 2)
        options.set_preference("browser.download.dir", DOWNLOAD_DIR)
        options.set_preference("browser.download.alwaysOpenPanel", False)
        options.set_preference("browser.helperApps.neverAsk.saveToDisk", "application/vnd.ms-excel;application/octet-stream")
        
        service = Service(executable_path=GECKODRIVER_PATH)
        driver = webdriver.Firefox(service=service, options=options)
        wait = WebDriverWait(driver, 30)

        # -------------------------------------------------------------
        # FUNÇÕES EXATAS DO FLUXO
        # -------------------------------------------------------------

        def clicar_monitoramento_e_status():
            """Clica em Monitoramento e depois em Status Comunicação."""
            limpar_bloqueios_tela(driver)
            try:
                # Clica em Monitoramento
                menu_monit = WebDriverWait(driver, 8).until(EC.element_to_be_clickable((
                    By.XPATH, "//div[@title='Monitoramento'] | //span[contains(text(), 'Monitoramento')] | //div[contains(text(), 'Monitoramento')] | //div[@data-testid='03']"
                )))
                driver.execute_script("arguments[0].click();", menu_monit)
                time.sleep(1.5)

                # Clica em Status Comunicação
                opcao_status = WebDriverWait(driver, 8).until(EC.element_to_be_clickable((
                    By.XPATH, "//span[contains(text(), 'Status Comunicação')] | //div[contains(text(), 'Status Comunicação')] | //a[contains(@href, 'communicationStatus')]"
                )))
                driver.execute_script("arguments[0].click();", opcao_status)
                time.sleep(5)
                limpar_bloqueios_tela(driver)
            except Exception as e_nav:
                print(f"     [Aviso Navegacao] Carregando URL direta: {e_nav}", flush=True)
                driver.get("https://flits.cittati.com.br/monitoring/communicationStatus")
                time.sleep(6)
                limpar_bloqueios_tela(driver)

        def clicar_pesquisar_depois_exportar(emp_nome, situacao_nome):
            """Garante filtro aberto, clica no botão Pesquisar e em seguida em Exportar Excel."""
            # 1. Se o botão 'Pesquisar' não estiver visível na tela, abre a gaveta do filtro
            botoes_pesq = driver.find_elements(By.XPATH, "//span[text()='Pesquisar']/ancestor::button | //button[not(contains(@class, 'hambuguer')) and .//span[contains(text(), 'Pesquisar')]]")
            if not botoes_pesq or not botoes_pesq[0].is_displayed():
                clicar_icone_filtro()

            # 2. Localiza ESTRITAMENTE o botão com o texto 'Pesquisar' (ignora qualquer botão hamburguer)
            btn_pesquisar = WebDriverWait(driver, 10).until(EC.element_to_be_clickable((
                By.XPATH, "//span[text()='Pesquisar']/ancestor::button | //button[not(contains(@class, 'hambuguer')) and .//span[contains(text(), 'Pesquisar')]]"
            )))
            driver.execute_script("arguments[0].click();", btn_pesquisar)
            print(f"      - [{emp_nome}] ({situacao_nome}): Botao Pesquisar clicado. Aguardando tabela...", flush=True)
            time.sleep(7)

            # 3. Verifica se há dados na tabela
            sem_dados = driver.find_elements(By.XPATH, "//*[contains(text(), 'Nenhum registro') or contains(text(), 'Sem dados') or contains(text(), 'Não há dados') or contains(@class, 'ant-empty')]")
            if sem_dados and any(el.is_displayed() for el in sem_dados):
                print(f"      - [{emp_nome}] ({situacao_nome}): Sem dados para exportar (0 registros).", flush=True)
            else:
                try:
                    arquivos_antes = set(glob.glob(os.path.join(DOWNLOAD_DIR, "*.xls*")))
                    
                    # 4. Clica em 'Exportar Excel'
                    btn_excel = WebDriverWait(driver, 8).until(
                        EC.presence_of_element_located((By.XPATH, "//span[@aria-label='file-excel'] | //button[.//span[@aria-label='file-excel']] | //*[local-name()='svg' and @data-icon='file-excel']/ancestor::button"))
                    )
                    driver.execute_script("arguments[0].click();", btn_excel)
                    
                    aguardar_conclusao_download(DOWNLOAD_DIR, timeout=10)
                    time.sleep(1.5)

                    arquivos_depois = set(glob.glob(os.path.join(DOWNLOAD_DIR, "*.xls*")))
                    novos_arquivos = sorted(list(arquivos_depois - arquivos_antes), key=os.path.getmtime, reverse=True)

                    if novos_arquivos:
                        arq_novo = novos_arquivos[0]
                        tamanho = os.path.getsize(arq_novo)
                        if tamanho == 0:
                            print(f"      - [{emp_nome}] ({situacao_nome}): Arquivo vazio de 0 bytes descartado.", flush=True)
                            try: os.remove(arq_novo)
                            except Exception: pass
                        else:
                            print(f"      - [{emp_nome}] ({situacao_nome}): Download OK ({tamanho} bytes).", flush=True)
                    else:
                        print(f"      - [{emp_nome}] ({situacao_nome}): Sem novos arquivos gerados.", flush=True)
                except Exception as e_down:
                    print(f"      - [{emp_nome}] ({situacao_nome}): Botao de exportacao nao localizado ou tabela vazia ({e_down}).", flush=True)

            # Verifica se há dados na tabela
            sem_dados = driver.find_elements(By.XPATH, "//*[contains(text(), 'Nenhum registro') or contains(text(), 'Sem dados') or contains(text(), 'Não há dados') or contains(@class, 'ant-empty')]")
            if sem_dados and any(el.is_displayed() for el in sem_dados):
                print(f"      - [{emp_nome}] ({situacao_nome}): Sem dados para exportar (0 registros).", flush=True)
            else:
                try:
                    arquivos_antes = set(glob.glob(os.path.join(DOWNLOAD_DIR, "*.xls*")))
                    
                    # Clica em 'Exportar Excel'
                    btn_excel = WebDriverWait(driver, 8).until(
                        EC.presence_of_element_located((By.XPATH, "//span[@aria-label='file-excel'] | //button[.//span[@aria-label='file-excel']] | //*[local-name()='svg' and @data-icon='file-excel']/ancestor::button"))
                    )
                    driver.execute_script("arguments[0].click();", btn_excel)
                    
                    aguardar_conclusao_download(DOWNLOAD_DIR, timeout=10)
                    time.sleep(1.5)

                    arquivos_depois = set(glob.glob(os.path.join(DOWNLOAD_DIR, "*.xls*")))
                    novos_arquivos = list(arquivos_depois - arquivos_antes)

                    if novos_arquivos:
                        arq_novo = novos_arquivos[0]
                        tamanho = os.path.getsize(arq_novo)
                        if tamanho == 0:
                            print(f"      - [{emp_nome}] ({situacao_nome}): Arquivo vazio de 0 bytes descartado.", flush=True)
                            os.remove(arq_novo)
                        else:
                            print(f"      - [{emp_nome}] ({situacao_nome}): Download OK ({tamanho} bytes).", flush=True)
                    else:
                        print(f"      - [{emp_nome}] ({situacao_nome}): Download disparado, mas nenhum arquivo gravado.", flush=True)
                except Exception as e_down:
                    print(f"      - [{emp_nome}] ({situacao_nome}): Botao de exportacao nao localizado ou tabela vazia ({e_down}).", flush=True)

        def clicar_icone_filtro():
            """Clica no ícone de Filtro (funil)."""
            limpar_bloqueios_tela(driver)
            btn_f = WebDriverWait(driver, 6).until(EC.element_to_be_clickable((
                By.XPATH, "//*[local-name()='svg' and @data-icon='filter']/parent::* | //button[contains(@class, 'filter')]"
            )))
            driver.execute_script("arguments[0].click();", btn_f)
            time.sleep(1.5)

        def selecionar_situacao_manutencao():
            """Seleciona a Situação 'Em Manutenção'."""
            box_sit = WebDriverWait(driver, 8).until(EC.element_to_be_clickable((
                By.XPATH, "//label[contains(., 'Situação')]/following::div[contains(@class, 'ant-select-selector')][1] | //div[@data-testid='Select-situation']//div[contains(@class, 'ant-select-selector')]"
            )))
            driver.execute_script("arguments[0].click();", box_sit)
            time.sleep(0.8)

            try:
                opcao = WebDriverWait(driver, 4).until(EC.element_to_be_clickable((
                    By.XPATH, "//div[contains(@class, 'ant-select-dropdown')]//div[contains(@class, 'ant-select-item-option-content') and (text()='Em Manutenção' or contains(., 'Em Manutenção'))]"
                )))
                driver.execute_script("arguments[0].click();", opcao)
            except Exception:
                ActionChains(driver).send_keys("Em Manutenção").pause(0.8).send_keys(Keys.ENTER).perform()
            time.sleep(1)

        def alterar_para_nova_empresa_e_fechar_antiga(nome_empresa):
            """Altera a Empresa no cabeçalho e CONFIRMA visualmente a troca antes de prosseguir."""
            limpar_bloqueios_tela(driver)
            sucesso_troca = False

            for tentativa_troca in range(3):
                try:
                    abas_antes = driver.window_handles
                    aba_atual = driver.current_window_handle

                    # Clica no seletor global context-select
                    box_emp = WebDriverWait(driver, 10).until(EC.element_to_be_clickable((
                        By.XPATH, "//div[contains(@class, 'context-select')]//div[contains(@class, 'ant-select-selector')] | //div[contains(@class, 'context-select')]"
                    )))
                    driver.execute_script("arguments[0].click();", box_emp)
                    time.sleep(1)

                    inp = WebDriverWait(driver, 6).until(EC.presence_of_element_located((
                        By.XPATH, "//div[contains(@class, 'context-select')]//input[@type='search']"
                    )))
                    inp.send_keys(Keys.CONTROL + "a")
                    inp.send_keys(Keys.BACKSPACE)
                    time.sleep(0.5)
                    inp.send_keys(nome_empresa)
                    time.sleep(2) # Aguarda o dropdown filtrar na tela

                    # Clica na opção exata correspondente no dropdown
                    try:
                        opcao = WebDriverWait(driver, 4).until(EC.element_to_be_clickable((
                            By.XPATH, f"//div[contains(@class, 'ant-select-dropdown')]//div[contains(@class, 'ant-select-item-option-content') and (contains(text(), '{nome_empresa}') or contains(., '{nome_empresa}'))]"
                        )))
                        driver.execute_script("arguments[0].click();", opcao)
                    except Exception:
                        inp.send_keys(Keys.ENTER)

                    time.sleep(3)

                    # Se o sistema abriu nova guia com a nova empresa:
                    abas_depois = driver.window_handles
                    if len(abas_depois) > len(abas_antes):
                        aba_nova = [a for a in abas_depois if a not in abas_antes][0]
                        driver.switch_to.window(aba_atual)
                        driver.close()
                        driver.switch_to.window(aba_nova)
                        time.sleep(5)
                        limpar_bloqueios_tela(driver)

                    # VALIDAÇÃO OBRIGATÓRIA: Confere se o texto da tela ativa realmente mudou para a empresa desejada
                    empresa_na_tela = identificar_empresa_ativa()
                    if nome_empresa.lower() in empresa_na_tela.lower() or empresa_na_tela.lower() in nome_empresa.lower():
                        print(f"     -> Empresa [{nome_empresa}] confirmada na tela ativa com sucesso.", flush=True)
                        sucesso_troca = True
                        break
                    else:
                        print(f"     [Aviso Troca] Tentativa {tentativa_troca + 1}: Tela permaneceu em [{empresa_na_tela}]. Repetindo selecao...", flush=True)
                        time.sleep(2)
                except Exception as e_troca:
                    print(f"     [Erro Troca] Tentativa {tentativa_troca + 1} falhou: {e_troca}", flush=True)
                    time.sleep(2)

            if not sucesso_troca:
                print(f"     [ALERTA CRÍTICO] Nao foi possivel confirmar a mudanca para [{nome_empresa}]!", flush=True)

        def identificar_empresa_ativa():
            """Lê qual empresa já está aberta na tela inicial."""
            try:
                el = driver.find_element(By.XPATH, "//div[contains(@class, 'context-select')]//span[contains(@class, 'ant-select-selection-item')] | //header//div[contains(@class, 'context-select')]")
                txt = el.text.strip()
                for emp in empresas:
                    if emp.lower() in txt.lower() or txt.lower() in emp.lower():
                        return emp
            except Exception: pass
            return empresas[0]

        # -------------------------------------------------------------
        # INÍCIO DO FLUXO
        # -------------------------------------------------------------

        # 1. Abre o Mozilla na página Flits, efetua login e clica em "Acesso" com espera segura
        print("     [1/4] Acessando Flits e realizando login...", flush=True)
        driver.get(URL_FLITS)
        time.sleep(3)

        campo_user = WebDriverWait(driver, 20).until(EC.element_to_be_clickable((By.NAME, "username")))
        campo_user.clear()
        campo_user.send_keys(USUARIO_FLITS)

        campo_pass = WebDriverWait(driver, 10).until(EC.element_to_be_clickable((By.NAME, "password")))
        campo_pass.clear()
        campo_pass.send_keys(SENHA_FLITS)
        
        btn_login = WebDriverWait(driver, 10).until(EC.element_to_be_clickable((By.CSS_SELECTOR, "button.btn-login, button[type='submit']")))
        driver.execute_script("arguments[0].click();", btn_login)
        print("     [2/4] Login submetido, aguardando 5s e fechando pop-ups ('Entendido' e 'Aceite')...", flush=True)
        time.sleep(5)
        limpar_bloqueios_tela(driver)

        # 2. Identifica qual empresa já está ativa e organiza a lista
        empresa_inicial = identificar_empresa_ativa()
        empresas_ordenadas = [empresa_inicial] + [e for e in empresas if e != empresa_inicial]
        print(f"     -> Empresa inicial ativa detectada: [{empresa_inicial}]", flush=True)

        # 3. Navegação inicial para Monitoramento -> Status Comunicação
        print("     [3/4] Clicando em Monitoramento e Status Comunicacao...", flush=True)
        clicar_monitoramento_e_status()

        # 4. Executa o loop para as 7 empresas
        print("     [4/4] Executando ciclo de exportacoes para as 7 empresas...", flush=True)

        for idx, emp_nome in enumerate(empresas_ordenadas):
            try:
                print(f"\n     === [{idx + 1}/{len(empresas_ordenadas)}] Empresa: {emp_nome} ===", flush=True)

                # A. Em seguida clique em "Pesquisar" depois em "Exportar Excel" (Operando já vem selecionado)
                clicar_pesquisar_depois_exportar(emp_nome, "Operando")

                # B. Clique no icone "Filtro" selecione a "Situação" "Em Manutenção"
                clicar_icone_filtro()
                selecionar_situacao_manutencao()

                # C. Em seguida clique em "Pesquisar" depois em "Exportar Excel"
                clicar_pesquisar_depois_exportar(emp_nome, "Em Manutenção")

                # D. Altera para uma nova "Empresa", fecha a guia antiga e clica em Monitoramento -> Status Comunicação
                if idx + 1 < len(empresas_ordenadas):
                    proxima_empresa = empresas_ordenadas[idx + 1]
                    print(f"\n     -> Alterando para nova Empresa: [{proxima_empresa}] e fechando guia antiga...", flush=True)
                    alterar_para_nova_empresa_e_fechar_antiga(proxima_empresa)
                    
                    print("     -> Clicando em Monitoramento e em Status Comunicacao...", flush=True)
                    clicar_monitoramento_e_status()

            except Exception as e_ciclo:
                print(f"      - [{emp_nome}]: Erro no ciclo: {e_ciclo}", flush=True)

        # 5. Fecha a janela do Mozilla e encerra o fluxo
        print("\n     [Fim do Fluxo] Fechando janela do Mozilla e processando arquivos baixados...", flush=True)
        driver.quit()
        processar_e_unificar_arquivos()
        return True

    except Exception as e_geral:
        print(f"[Erro Geral] {e_geral}", flush=True)
        if driver: driver.quit()
        return False

# =====================================================================
#             PROCESSAMENTO E UNIFICAÇÃO (LIMPEZA DE COLUNAS)
# =====================================================================

def processar_e_unificar_arquivos():
    time.sleep(2)
    arquivos = glob.glob(os.path.join(DOWNLOAD_DIR, "*.xlsx")) + glob.glob(os.path.join(DOWNLOAD_DIR, "*.xls"))
    if not arquivos: return
    
    dados_totais = []
    now = datetime.now()
    data_extracao = now.strftime("%d/%m/%Y")
    hora_extracao = now.strftime("%Hh")
    hora_minuto_extracao = now.strftime("%Hh%M")
    
    segmentos_avul = ["Urubupungá", "Urubupungá Municipal Osasco", "Urubupungá Municipal Santana", "Urubupungá Municipal Cajamar"]

    colunas_para_ignorar = [
        "Placa", "Firmware do AVUL", "Firmware do AVL", "Último Gps", "Último GPS", 
        "Última transmissão", "Última Transmissão GP", "Ponto", "Validador Status"
    ]

    for arq in arquivos:
        try:
            if not os.path.exists(arq) or os.path.getsize(arq) == 0:
                if os.path.exists(arq): os.remove(arq)
                continue
        except Exception:
            continue

        try:
            try: df = pd.read_excel(arq)
            except: df = pd.read_html(arq)[0]

            if df.empty or len(df) == 0:
                os.remove(arq)
                continue

            if "Empresa" in df.iloc[0].values:
                df.columns = df.iloc[0]
                df = df[1:]
            elif "0" in df.columns or isinstance(df.columns[0], (int, float)):
                df.columns = df.iloc[0]
                df = df[1:]

            df = df.fillna("")

            if df.empty or len(df) == 0:
                os.remove(arq)
                continue
            
            if 'Empresa' in df.columns:
                df = df[df['Empresa'] != 'Empresa']
                df = df.rename(columns={'Empresa': 'Segmento'})
                df['Empresa'] = df['Segmento'].apply(lambda x: "AVUL" if x in segmentos_avul else "VCCL")

            df = df.drop(columns=[c for c in colunas_para_ignorar if c in df.columns])
            
            lista_registros = df.to_dict(orient='records')
            for registro in lista_registros:
                registro["Data"] = data_extracao
                registro["Hora"] = hora_extracao
                registro["Hora_Extracao"] = hora_minuto_extracao
            
            dados_totais.extend(lista_registros)
            os.remove(arq)
        except Exception as e:
            tamanho = os.path.getsize(arq) if os.path.exists(arq) else 0
            nome_arq = os.path.basename(arq)
            print(f"[Falha de Leitura] Arquivo '{nome_arq}' (Tamanho: {tamanho} bytes) gerou o erro: {e}")
            if os.path.exists(arq): os.remove(arq)

    if not dados_totais: return

    dia_p, ano_p = now.strftime("%d"), str(now.year)
    mes_n = MESES_PT[now.month]
    diretorio_backup = os.path.join(DOWNLOAD_DIR, ano_p, mes_n, dia_p, now.strftime("%Hh"))
    os.makedirs(diretorio_backup, exist_ok=True)
    with open(os.path.join(diretorio_backup, "status_comunicacao.json"), 'w', encoding='utf-8') as f:
        json.dump(dados_totais, f, ensure_ascii=False, indent=4)
    
    nome_json = f"dados-{now.strftime('%d-%m-%Y')}.json"
    caminho_local = os.path.join(LOCAL_PROJETO_DIR, nome_json)

    # 1. ACÚMULO TOTAL E SEGURO: Preserva histórico de todas as extrações do dia
    registros_existentes = []
    if os.path.exists(caminho_local):
        try:
            with open(caminho_local, 'r', encoding='utf-8') as f_existente:
                registros_existentes = json.load(f_existente)
        except Exception:
            registros_existentes = []

    # Dicionário indexado por chave completa única para não perder registros legítimos
    mapa_unificado = {}

    def gerar_chave_unica(reg):
        # A chave considera Prefixo + Data + Hora + Situação + Empresa para nunca mesclar dados distintos
        prefixo = str(reg.get("Prefixo", reg.get("Veículo", ""))).strip().zfill(5)
        data = str(reg.get("Data", "")).strip()
        hora = str(reg.get("Hora", "")).strip()
        situacao = str(reg.get("Situação Veículo", reg.get("Situação", ""))).strip()
        empresa = str(reg.get("Empresa", reg.get("Segmento", ""))).strip()
        return f"{prefixo}_{data}_{hora}_{situacao}_{empresa}"

    # Carrega registros já existentes no arquivo diário
    for reg in registros_existentes:
        chave = gerar_chave_unica(reg)
        if chave.strip("_"):
            mapa_unificado[chave] = reg

    # Se a nova extração trouxe veículos, adiciona/atualiza garantindo integridade
    for reg in dados_totais:
        chave = gerar_chave_unica(reg)
        if chave.strip("_"):
            mapa_unificado[chave] = reg

    # HERANÇA DE FROTA: Garante que todos os veículos conhecidos existam na hora atual
    # Se uma empresa teve falha de exportação na hora atual, replica o status anterior para não sumir da frota
    todos_prefixos_conhecidos = {}
    for reg in mapa_unificado.values():
        p = str(reg.get("Prefixo", "")).strip().zfill(5)
        if p and p != "00000":
            todos_prefixos_conhecidos[p] = reg

    # Para cada prefixo conhecido, garante que ele exista na extração da hora atual
    for p, reg_molde in todos_prefixos_conhecidos.items():
        chave_hora_atual = f"{p}_{data_extracao}_{hora_extracao}_{reg_molde.get('Situação Veículo', '')}_{reg_molde.get('Empresa', '')}"
        if chave_hora_atual not in mapa_unificado:
            # Clona o registro para a hora atual sem perder o veículo
            registro_herdado = dict(reg_molde)
            registro_herdado["Data"] = data_extracao
            registro_herdado["Hora"] = hora_extracao
            registro_herdado["Hora_Extracao"] = hora_minuto_extracao
            mapa_unificado[chave_hora_atual] = registro_herdado

    registros_consolidados = list(mapa_unificado.values())

    with open(caminho_local, 'w', encoding='utf-8') as f:
        json.dump(registros_consolidados, f, ensure_ascii=False, indent=4)
    
    shutil.copy(caminho_local, os.path.join(LOCAL_PROJETO_DIR, "dados.json"))
    
    # POLÍTICA DE RETENÇÃO: Mantém apenas os 7 dias mais recentes
    arquivos_diarios = glob.glob(os.path.join(LOCAL_PROJETO_DIR, "dados-*.json"))
    mapa_datas_arquivos = []

    for arq_j in arquivos_diarios:
        nome_base = os.path.basename(arq_j).replace("dados-", "").replace(".json", "")
        try:
            d, m, a = nome_base.split("-")
            data_obj = datetime.strptime(f"{d}/{m}/{a}", "%d/%m/%Y")
            mapa_datas_arquivos.append({
                "caminho": arq_j,
                "data_str": f"{d}/{m}/{a}",
                "data_obj": data_obj
            })
        except Exception: pass

    # Ordena as datas do mais antigo para o mais recente
    mapa_datas_arquivos.sort(key=lambda x: x["data_obj"])

    # Se houver mais de 7 dias, apaga os arquivos mais antigos que ultrapassarem o limite
    while len(mapa_datas_arquivos) > 7:
        mais_antigo = mapa_datas_arquivos.pop(0)
        try:
            if os.path.exists(mais_antigo["caminho"]):
                os.remove(mais_antigo["caminho"])
                print(f"[Retencao 7 Dias] Arquivo antigo removido: {os.path.basename(mais_antigo['caminho'])}")
        except Exception as e_del:
            print(f"[Erro Limpeza] Falha ao remover {mais_antigo['caminho']}: {e_del}")

    # Salva datas.json contendo apenas a lista dos 7 dias vigentes
    lista_ord = [item["data_str"] for item in mapa_datas_arquivos]
    with open(os.path.join(LOCAL_PROJETO_DIR, "datas.json"), 'w', encoding='utf-8') as f:
        json.dump(lista_ord, f, ensure_ascii=False, indent=4)

    # Exporta as fichas de manutenção do SQLite para fichas_manutencao.json antes de subir ao Git
    exportar_fichas_para_json()

    enviar_para_github(nome_json)

# =====================================================================
#                         ROTAS DO FLASK
# =====================================================================

@app.route('/')
def index(): return send_from_directory('.', 'index.html')
@app.route('/app.js')
def serve_js(): return send_from_directory('.', 'app.js')
@app.route('/style.css')
def serve_css(): return send_from_directory('.', 'style.css')

@app.route('/fichas_manutencao.json')
def serve_fichas():
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT id, veiculo, data_abertura, hora_abertura, data_fechamento, hora_fechamento FROM fichas_manutencao")
        fichas = [dict(row) for row in cursor.fetchall()]
    return jsonify(fichas)

def exportar_fichas_para_json():
    """Lê o SQLite e gera o arquivo fichas_manutencao.json atualizado."""
    try:
        with sqlite3.connect(DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT id, veiculo, data_abertura, hora_abertura, data_fechamento, hora_fechamento FROM fichas_manutencao")
            fichas = [dict(row) for row in cursor.fetchall()]
        
        caminho_fichas = os.path.join(LOCAL_PROJETO_DIR, "fichas_manutencao.json")
        with open(caminho_fichas, 'w', encoding='utf-8') as f:
            json.dump(fichas, f, ensure_ascii=False, indent=4)
    except Exception as e:
        print(f"[Erro ao exportar fichas para JSON] {e}", flush=True)

@app.route('/salvar-ficha-item', methods=['POST'])
def salvar_ficha_item():
    dados = request.get_json()
    veiculo = dados.get("veiculo")
    data_ab = dados.get("data_abertura")
    hora_ab = dados.get("hora_abertura")
    
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT OR IGNORE INTO fichas_manutencao (veiculo, data_abertura, hora_abertura)
            VALUES (?, ?, ?)
        ''', (veiculo, data_ab, hora_ab))
        conn.commit()
    
    exportar_fichas_para_json()
    return jsonify({"status": "sucesso"})

@app.route('/fechar-ficha-item', methods=['POST'])
def fechar_ficha_item():
    dados = request.get_json()
    ficha_id = dados.get("id")
    data_fc = dados.get("data_fechamento")
    hora_fc = dados.get("hora_fechamento")
    
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            UPDATE fichas_manutencao 
            SET data_fechamento = ?, hora_fechamento = ?
            WHERE id = ?
        ''', (data_fc, hora_fc, ficha_id))
        conn.commit()
    
    exportar_fichas_para_json()
    return jsonify({"status": "sucesso"})

@app.route('/datas.json')
def serve_datas(): return send_from_directory('.', 'datas.json')
@app.route('/dados.json')
def serve_dados(): return send_from_directory('.', 'dados.json')
@app.route('/dados-<data_str>.json')
def serve_dados_hist(data_str): return send_from_directory('.', f"dados-{data_str}.json")

# =====================================================================
#                     EXECUÇÃO E AGENDAMENTO
# =====================================================================

def executar_com_bloqueio(origem="Manual"):
    if not executando_lock.locked():
        with executando_lock:
            print(f"\n>>> Rodada {origem} Iniciada em {datetime.now().strftime('%H:%M:%S')} <<<")
            iniciar_automacao_flits()

def loop_agendamento():
    while True:
        agora = datetime.now()
        alvos = [7, 22, 37, 52]
        prox = [agora.replace(minute=m, second=0, microsecond=0) for m in alvos]
        espera = (min([p if p > agora else p + timedelta(hours=1) for p in prox]) - agora).total_seconds()
        time.sleep(espera)
        executar_com_bloqueio("Agendada")

if __name__ == '__main__':
    log = logging.getLogger('werkzeug')
    log.setLevel(logging.ERROR)
    Thread(target=lambda: app.run(host='127.0.0.1', port=5000, debug=False, use_reloader=False), daemon=True).start()
    Thread(target=executar_com_bloqueio, args=("Inicial",), daemon=True).start()
    def escuta():
        while True:
            try: input(); Thread(target=executar_com_bloqueio, args=("Manual",), daemon=True).start()
            except EOFError: break
    Thread(target=escuta, daemon=True).start()
    loop_agendamento()