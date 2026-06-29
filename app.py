import os
import time
import glob
import json
import logging
import subprocess
from datetime import datetime, timedelta
from threading import Thread, Lock
import pandas as pd
from flask import Flask, jsonify, send_from_directory
from selenium import webdriver
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC

# Inicializa o Flask configurado para ler arquivos da mesma pasta raiz
app = Flask(__name__, static_folder='.', template_folder='.')

# Configurações de pastas e arquivos locais de forma dinâmica
user_home = os.path.expanduser("~")
DOWNLOAD_DIR = os.path.join(user_home, "OneDrive - Nossa Senhora do Ó Participações S.A", "Status em Python")
GECKODRIVER_PATH = r"C:\Projetos em Python\Status em Python\geckodriver.exe"
LOCAL_PROJETO_DIR = r"C:\Projetos em Python\Status em Python"

# Credenciais do sistema
USUARIO_GOOL = "status.nso"
SENHA_GOOL = "@Cmi123"

# Lock de controle para evitar conflito de concorrência
executando_lock = Lock()

# Dicionários de mapeamento de meses para controle de caminhos
MESES_PT_REV = {
    "Janeiro": "01", "Fevereiro": "02", "Março": "03", "Abril": "04",
    "Maio": "05", "Junho": "06", "Julho": "07", "Agosto": "08",
    "Setembro": "09", "Outubro": "10", "Novembro": "11", "Dezembro": "12"
}
MESES_PT = {int(v): k for k, v in MESES_PT_REV.items()}

# =====================================================================
#             FUNÇÕES DE INTEGRAÇÃO COM GITHUB
# =====================================================================

def enviar_para_github():
    """Executa comandos git de commit e push de forma silenciosa para o GitHub."""
    try:
        print("[Git] Adicionando arquivos de dados modificados...")
        subprocess.run(["git", "add", "datas.json", "dados.json", "dados-*.json", "index.html", "app.js", "style.css"], cwd=LOCAL_PROJETO_DIR, check=True)
        
        status = subprocess.run(["git", "status", "--porcelain"], cwd=LOCAL_PROJETO_DIR, capture_output=True, text=True)
        if not status.stdout.strip():
            print("[Git] Nenhuma alteração encontrada para comitar.")
            return
            
        print("[Git] Criando commit...")
        subprocess.run(["git", "commit", "-m", "Automacao: Sincronizacao de dados"], cwd=LOCAL_PROJETO_DIR, check=True)
        
        print("[Git] Enviando alterações ao GitHub...")
        subprocess.run(["git", "push", "origin", "main"], cwd=LOCAL_PROJETO_DIR, check=True)
        print("[Git] Sincronização concluída.")
    except Exception as e:
        print(f"[Git - Erro] Falha ao sincronizar com o GitHub: {e}")

# =====================================================================
#             ROTAS E LOGICA DO SERVIDOR DO DASHBOARD
# =====================================================================

def buscar_caminho_firefox():
    """Busca o executável do Firefox nos caminhos padrões do Windows."""
    caminhos_provaveis = [
        r"C:\Program Files\Mozilla Firefox\firefox.exe",
        r"C:\Program Files (x86)\Mozilla Firefox\firefox.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Mozilla Firefox\firefox.exe")
    ]
    for caminho in caminhos_provaveis:
        if os.path.exists(caminho):
            return caminho
    return None

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/app.js')
def serve_js():
    return send_from_directory('.', 'app.js')

@app.route('/style.css')
def serve_css():
    return send_from_directory('.', 'style.css')

@app.route('/datas.json')
def serve_lista_datas():
    datas = set()
    if not os.path.exists(DOWNLOAD_DIR):
        return jsonify([])
        
    padrao = os.path.join(DOWNLOAD_DIR, "**", "unificado_*.json")
    arquivos_unificados = glob.glob(padrao, recursive=True)
    
    for caminho in arquivos_unificados:
        nome_arquivo = os.path.basename(caminho)
        parte_data = nome_arquivo.replace("unificado_", "").replace(".json", "")
        try:
            dia, mes, ano = parte_data.split("-")
            datas.add(f"{dia}/{mes}/{ano}")
        except:
            pass
            
    lista_ordenada = sorted(list(datas), key=lambda x: datetime.strptime(x, "%d/%m/%Y"))
    return jsonify(lista_ordenada)

@app.route('/dados-<data_str>.json')
def serve_dados_data(data_str):
    data_normal = data_str.replace('-', '/')
    dados = obter_dados_da_data(data_normal)
    return jsonify(dados)

@app.route('/dados.json')
def serve_dados_atual():
    datas = listar_datas_disponiveis_interno()
    if datas:
        ultima_data = datas[-1]
        dados = obter_dados_da_data(ultima_data)
        return jsonify(dados)
    return jsonify([])

@app.after_request
def evitar_cache(response):
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '-1'
    return response

def listar_datas_disponiveis_interno():
    datas = set()
    if not os.path.exists(DOWNLOAD_DIR):
        return []
    for ano in os.listdir(DOWNLOAD_DIR):
        caminho_ano = os.path.join(DOWNLOAD_DIR, ano)
        if not os.path.isdir(caminho_ano) or not ano.isdigit():
            continue
        for mes_nome in os.listdir(caminho_ano):
            caminho_mes = os.path.join(caminho_ano, mes_nome)
            if not os.path.isdir(caminho_mes) or mes_nome not in MESES_PT_REV:
                continue
            mes_num = MESES_PT_REV[mes_nome]
            for dia_nome in os.listdir(caminho_mes):
                caminho_dia = os.path.join(caminho_mes, dia_nome)
                if not os.path.isdir(caminho_dia) or not dia_nome.isdigit():
                    continue
                datas.add(f"{int(dia_nome):02d}/{mes_num}/{ano}")
    return sorted(list(datas), key=lambda x: datetime.strptime(x, "%d/%m/%Y"))

def obter_dados_da_data(data_str):
    try:
        dia, mes_num, ano = data_str.split("/")
        mes_nome = MESES_PT[int(mes_num)]
        dia_str = f"{int(dia):02d}"
        
        caminho_dia = os.path.join(DOWNLOAD_DIR, ano, mes_nome, dia_str)
        if not os.path.exists(caminho_dia):
            return []
            
        nome_unificado = f"unificado_{dia_str}-{mes_num}-{ano}.json"
        caminho_unificado = os.path.join(caminho_dia, nome_unificado)
        
        if os.path.exists(caminho_unificado):
            try:
                with open(caminho_unificado, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                print(f"[Erro] Falha ao ler arquivo unificado {caminho_unificado}: {e}")
                
        dados_dia = []
        padrao_horas_dia = os.path.join(caminho_dia, "*h", "status_comunicacao.json")
        arquivos_horas = glob.glob(padrao_horas_dia)
        
        for arq_hora in arquivos_horas:
            try:
                nome_pasta_hora = os.path.basename(os.path.dirname(arq_hora))
                with open(arq_hora, 'r', encoding='utf-8') as f:
                    registros_hora = json.load(f)
                    for r in registros_hora:
                        r["_data_pasta"] = f"{dia_str}/{mes_num}/{ano}"  # Formato dd/mm/aaaa
                        r["_hora_pasta"] = nome_pasta_hora
                    dados_dia.extend(registros_hora)
            except Exception as e:
                print(f"[Erro] Falha ao ler arquivo de hora {arq_hora}: {e}")
        return dados_dia
    except Exception as e:
        print(f"[Erro] Falha na junção de dados da data {data_str}: {e}")
        return []

# =====================================================================
#                 ROTINA DO ROBO AUTOMATIZADO (SELENIUM)
# =====================================================================

def obter_arquivos_existentes():
    return set(glob.glob(os.path.join(DOWNLOAD_DIR, "*")))

def aguardar_loadmask(driver, timeout=15):
    try:
        WebDriverWait(driver, timeout).until(
            EC.invisibility_of_element_located((By.XPATH, "//*[contains(@class, 'loadmask')]"))
        )
        time.sleep(1)
    except:
        pass

def aguardar_conclusao_download(diretorio, conjunto_arquivos_antigo, timeout=45):
    tempo_limite = time.time() + timeout
    while time.time() < tempo_limite:
        arquivos_atuais = set(glob.glob(os.path.join(diretorio, "*")))
        arquivos_temporarios = [f for f in arquivos_atuais if f.endswith(".part") or f.endswith(".tmp")]
        
        if not arquivos_temporarios:
            novos_arquivos = arquivos_atuais - conjunto_arquivos_antigo
            novos_reais = [f for f in novos_arquivos if os.path.isfile(f) and f.endswith(('.xls', '.xlsx'))]
            if novos_reais:
                return True
        time.sleep(1)
    return False

def selecionar_empresa_com_postback(driver, value):
    """Seleciona a empresa no dropdown de forma segura, limpando a loadmask antes e depois."""
    wait = WebDriverWait(driver, 15)
    select_id = "ContentPlaceHolder1_contentFiltroPesquisa_ddlEmpresa"
    
    aguardar_loadmask(driver)
    select_element = wait.until(EC.element_to_be_clickable((By.ID, select_id)))
    select = Select(select_element)
    select.select_by_value(value)
    
    time.sleep(2)
    aguardar_loadmask(driver)
    wait.until(EC.element_to_be_clickable((By.ID, select_id)))

def carregar_dados_xls(caminho_arquivo):
    try:
        df = pd.read_excel(caminho_arquivo)
        return df
    except Exception as e_xls:
        try:
            dfs = pd.read_html(caminho_arquivo)
            if dfs:
                return dfs[0]
        except Exception as e_html:
            pass
    return None

def processar_e_unificar_arquivos():
    """Salva a execução individual na pasta de hora. Se for 23h52, gera o consolidado unificado."""
    padrao_busca = os.path.join(DOWNLOAD_DIR, "pesquisar status de comunicação*.xls")
    arquivos_xls = glob.glob(padrao_busca)
    
    if not arquivos_xls:
        return False, "Nenhum arquivo XLS temporário na raiz para processar."
        
    dados_da_hora_atual = []
    print(f"\n--- Iniciando processamento de {len(arquivos_xls)} arquivo(s) XLS ---")
    
    for caminho_arquivo in arquivos_xls:
        nome_curto = os.path.basename(caminho_arquivo)
        df = carregar_dados_xls(caminho_arquivo)
        if df is not None:
            df = df.fillna("")
            dados_planilha = df.to_dict(orient='records')
            dados_da_hora_atual.extend(dados_planilha)
            print(f"-> {len(dados_planilha)} registros extraídos de {nome_curto}.")
        else:
            print(f"-> Falha ao extrair dados de: {nome_curto}.")
            
    # Define diretório específico de hora (sobrepondo o anterior da mesma hora)
    now = datetime.now()
    ano = str(now.year)
    mes_nome = MESES_PT[now.month]
    dia_str = f"{now.day:02d}"
    hora_str = f"{now.hour:02d}h"
    
    diretorio_hora = os.path.join(DOWNLOAD_DIR, ano, mes_nome, dia_str, hora_str)
    os.makedirs(diretorio_hora, exist_ok=True)
    
    caminho_json_hora = os.path.join(diretorio_hora, "status_comunicacao.json")
    with open(caminho_json_hora, 'w', encoding='utf-8') as f:
        json.dump(dados_da_hora_atual, f, ensure_ascii=False, indent=4)
    print(f"[Backup OneDrive] Salvo arquivo individual da hora em: {caminho_json_hora}")
    
    # UNIFICAÇÃO FÍSICA NO ONEDRIVE: Ocorre apenas às 23h52
    caminho_unificado_salvo = None
    if now.hour == 23 and now.minute == 52:
        diretorio_dia = os.path.join(DOWNLOAD_DIR, ano, mes_nome, dia_str)
        padrao_horas_dia = os.path.join(diretorio_dia, "*h", "status_comunicacao.json")
        arquivos_horas = glob.glob(padrao_horas_dia)
        
        todos_dados_dia = []
        print(f"[Unificação - Fim do Dia] Consolidando {len(arquivos_horas)} horas de dados...")
        
        for arq_hora in arquivos_horas:
            try:
                nome_pasta_hora = os.path.basename(os.path.dirname(arq_hora))
                with open(arq_hora, 'r', encoding='utf-8') as f:
                    registros_hora = json.load(f)
                    for r in registros_hora:
                        r["_data_pasta"] = f"{dia_str}/{now.month:02d}/{ano}"
                        r["_hora_pasta"] = nome_pasta_hora
                    todos_dados_dia.extend(registros_hora)
            except Exception as e:
                print(f"[Erro] Falha ao ler arquivo de hora {arq_hora}: {e}")
                
        nome_unificado = f"unificado_{dia_str}-{now.month:02d}-{ano}.json"
        caminho_unificado_salvo = os.path.join(diretorio_dia, nome_unificado)
        
        with open(caminho_unificado_salvo, 'w', encoding='utf-8') as f:
            json.dump(todos_dados_dia, f, ensure_ascii=False, indent=4)
        print(f"[Unificação - Fim do Dia] Salvo com sucesso em: {caminho_unificado_salvo}")
    else:
        print(f"[Hora] Execução concluída. Unificação física no OneDrive agendada para às 23h52.")
        
    # Salva os arquivos locais para envio ao GitHub
    caminho_dados_dia_local = os.path.join(LOCAL_PROJETO_DIR, f"dados-{dia_str}-{now.month:02d}-{ano}.json")
    todos_dados_atuais_mesclados = obter_dados_da_data(f"{dia_str}/{now.month:02d}/{ano}")
    
    with open(caminho_dados_dia_local, 'w', encoding='utf-8') as f:
        json.dump(todos_dados_atuais_mesclados, f, ensure_ascii=False, indent=4)
        
    caminho_dados_atual_local = os.path.join(LOCAL_PROJETO_DIR, "dados.json")
    with open(caminho_dados_atual_local, 'w', encoding='utf-8') as f:
        json.dump(todos_dados_atuais_mesclados, f, ensure_ascii=False, indent=4)
        
    # Atualiza a lista de datas locais para o GitHub
    datas_disponiveis = set()
    for arq_local in glob.glob(os.path.join(LOCAL_PROJETO_DIR, "dados-*.json")):
        nome_base = os.path.basename(arq_local)
        parte_data = nome_base.replace("dados-", "").replace(".json", "")
        try:
            d, m, a = parte_data.split("-")
            datas_disponiveis.add(f"{d}/{m}/{a}")
        except:
            pass
            
    lista_datas_ordenada = sorted(list(datas_disponiveis), key=lambda x: datetime.strptime(x, "%d/%m/%Y"))
    caminho_datas_local = os.path.join(LOCAL_PROJETO_DIR, "datas.json")
    with open(caminho_datas_local, 'w', encoding='utf-8') as f:
        json.dump(lista_datas_ordenada, f, ensure_ascii=False, indent=4)
        
    for caminho_arquivo in arquivos_xls:
        try:
            os.remove(caminho_arquivo)
        except:
            pass
            
    enviar_para_github()
    return True, caminho_dados_dia_local

def imprimir_tabela_logs(logs):
    print("\n" + "="*85)
    print("                      RELATÓRIO DE EXPORTAÇÃO DE ARQUIVOS")
    print("="*85)
    print(f"{'Empresa':<45} | {'Situação':<15} | {'Status'}")
    print("-" * 85)
    for log in logs:
        empresa_truncada = log['empresa'][:45]
        print(f"{empresa_truncada:<45} | {log['situacao']:<15} | {log['status']}")
    print("="*85 + "\n")

def executar_ciclo_pesquisa(driver, situacao_nome, logs):
    wait = WebDriverWait(driver, 15)
    
    select_empresa_el = wait.until(EC.presence_of_element_located((By.ID, "ContentPlaceHolder1_contentFiltroPesquisa_ddlEmpresa")))
    select_empresa = Select(select_empresa_el)
    empresas = [opt.get_attribute("value") for opt in select_empresa.options if opt.get_attribute("value") != "0"]
    
    for valor_empresa in empresas:
        select_empresa_el = driver.find_element(By.ID, "ContentPlaceHolder1_contentFiltroPesquisa_ddlEmpresa")
        select_temp = Select(select_empresa_el)
        texto_empresa = next(opt.text for opt in select_temp.options if opt.get_attribute("value") == valor_empresa)
        
        try:
            selecionar_empresa_com_postback(driver, valor_empresa)
            aguardar_loadmask(driver)
            
            btn_pesquisar = wait.until(EC.element_to_be_clickable(
                (By.XPATH, "//p[contains(@class, 'iconePesquisar') or contains(text(), 'Pesquisar')]")
            ))
            btn_pesquisar.click()
            
            time.sleep(1.5)
            aguardar_loadmask(driver)
            
            try:
                excel_button = WebDriverWait(driver, 30).until(
                    EC.element_to_be_clickable((By.XPATH, "//input[contains(@src, 'icon-doc-excel.gif')]"))
                )
            except:
                excel_button = None
            
            if not excel_button:
                logs.append({"empresa": texto_empresa, "situacao": situacao_nome, "status": "Falta de Informação"})
                continue
            
            arquivos_antes = obter_arquivos_existentes()
            excel_button.click()
            time.sleep(1.5)
            
            try:
                alert = driver.switch_to.alert
                alert.accept()
                logs.append({"empresa": texto_empresa, "situacao": situacao_nome, "status": "Falta de Informação"})
                continue
            except:
                pass
            
            sucesso_download = aguardar_conclusao_download(DOWNLOAD_DIR, arquivos_antes, timeout=45)
            
            if sucesso_download:
                logs.append({"empresa": texto_empresa, "situacao": situacao_nome, "status": "Exportado com Sucesso"})
                time.sleep(1)
            else:
                logs.append({"empresa": texto_empresa, "situacao": situacao_nome, "status": "Falta de Informação"})
                
        except:
            logs.append({"empresa": texto_empresa, "situacao": situacao_nome, "status": "Falta de Informação"})

def iniciar_automacao():
    logs_execucao = []
    
    try:
        options = Options()
        caminho_firefox = buscar_caminho_firefox()
        if not caminho_firefox:
            print("[Erro] Não foi possível encontrar o Firefox instalado.")
            return False
        
        options.binary_location = caminho_firefox
        options.set_preference("browser.download.folderList", 2)
        options.set_preference("browser.download.dir", DOWNLOAD_DIR)
        options.set_preference("browser.helperApps.neverAsk.saveToDisk", "application/vnd.ms-excel;application/octet-stream;application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        options.set_preference("browser.download.manager.showWhenStarting", False)
        options.set_preference("dom.allow_multiple_downloads", True)
        options.set_preference("browser.download.useDownloadDir", True)
        
        service = Service(executable_path=GECKODRIVER_PATH)
        driver = webdriver.Firefox(service=service, options=options)
        
        # 1. Acessa o Portal GOOL
        driver.get("https://gool.cittati.com.br/Login.aspx?ReturnUrl=%2f")
        wait = WebDriverWait(driver, 15)
        
        # 2. Seleciona o módulo Urbano
        btn_urbano = wait.until(EC.element_to_be_clickable((By.ID, "ucTrocarModulo_btnIconeUrbano")))
        btn_urbano.click()
        time.sleep(2)
        
        # 3. Realiza o login (senha fixa)
        campo_usuario = wait.until(EC.visibility_of_element_located((By.ID, "ucLogarUsuario_txtLogin")))
        campo_usuario.clear()
        campo_usuario.send_keys(USUARIO_GOOL)
        
        campo_senha = wait.until(EC.visibility_of_element_located((By.ID, "ucLogarUsuario_txtSenha")))
        campo_senha.clear()
        campo_senha.send_keys(SENHA_GOOL)
        
        btn_logar = wait.until(EC.element_to_be_clickable((By.ID, "ucLogarUsuario_btnLogar")))
        btn_logar.click()
        
        # 4. Acessa "Status de Comunicação"
        btn_status_comunicacao = wait.until(EC.element_to_be_clickable((By.XPATH, "//span[@title='Status de Comunicação']")))
        btn_status_comunicacao.click()
        time.sleep(4)
        
        # --- CICLO 1: Veículos em situação "Operando" ---
        executar_ciclo_pesquisa(driver, "Operando", logs_execucao)
        
        # --- CICLO 2: Veículos em situação "Em Manutenção" ---
        aguardar_loadmask(driver)
        select_situacao_el = wait.until(EC.element_to_be_clickable((By.ID, "ContentPlaceHolder1_contentFiltroPesquisa_ddlSituacaoVeiculo")))
        select_situacao = Select(select_situacao_el)
        select_situacao.select_by_value("M")
        
        time.sleep(2)
        aguardar_loadmask(driver)
        
        executar_ciclo_pesquisa(driver, "Em Manutenção", logs_execucao)
        
        # Fecha o navegador
        driver.quit()
        
        # --- PROCESSO DE UNIFICAÇÃO ---
        sucesso_unificacao, resultado_unificacao = processar_e_unificar_arquivos()
        
        imprimir_tabela_logs(logs_execucao)
        if sucesso_unificacao:
            print(f"[Sucesso] Unificação gerada: {resultado_unificacao}")
        else:
            print(f"[Aviso] {resultado_unificacao}")
            
        return True
    except Exception as e:
        print(f"[Erro Geral] Falha na execução da rotina: {e}")
        return False

def executar_com_bloqueio(origem="Manual"):
    """Controle de Lock para que o agendador e o clique manual não conflitem."""
    if executando_lock.locked():
        print(f"\n[Aviso] O robô já está executando uma tarefa. Clique '{origem}' desconsiderado.")
        return
        
    with executando_lock:
        print(f"\n>>> Iniciando tarefa automática ({origem}) às {datetime.now().strftime('%H:%M:%S')} >>>")
        iniciar_automacao()

# =====================================================================
#             ROUTINES DO AGENDADOR E CONTROLES DE TERMINAL
# =====================================================================

def escutar_teclado():
    """Escuta do terminal PowerShell: Permite ao usuário clicar ENTER para rodar manualmente."""
    while True:
        input()
        Thread(target=executar_com_bloqueio, args=("Manual",), daemon=True).start()

def obter_segundos_ate_proximo_agendamento():
    """Calcula os segundos restantes até os minutos 07, 22, 37 ou 52 subsequentes."""
    agora = datetime.now()
    alvos = [7, 22, 37, 52]
    proximos_horarios = []
    
    for minuto in alvos:
        proximo = agora.replace(minute=minuto, second=0, microsecond=0)
        if proximo <= agora:
            proximo += timedelta(hours=1)
        proximos_horarios.append(proximo)
        
    proximo_agendamento = min(proximos_horarios)
    return (proximo_agendamento - agora).total_seconds()

def loop_agendamento():
    while True:
        segundos_espera = obter_segundos_ate_proximo_agendamento()
        proximo_horario = datetime.now() + timedelta(seconds=segundos_espera)
        print(f"[Agendador] Próxima execução programada para: {proximo_horario.strftime('%d/%m/%Y %H:%M:%S')}")
        
        tempo_limite = time.time() + segundos_espera
        while time.time() < tempo_limite:
            time.sleep(1)
            
        executar_com_bloqueio("Agendada")

def rodar_servidor_web():
    """Inicia o servidor Flask de forma silenciosa para hospedar o Dashboard."""
    # Desativa logs poluídos no terminal para manter focado na execução
    log = logging.getLogger('werkzeug')
    log.setLevel(logging.ERROR)
    
    print("\n[Servidor Web] Iniciando o Dashboard local no endereço: http://127.0.0.1:5000\n")
    app.run(host='127.0.0.1', port=5000, debug=False, use_reloader=False)

if __name__ == '__main__':
    # 1. Inicia o Servidor Web do Dashboard em segundo plano (silencioso)
    Thread(target=rodar_servidor_web, daemon=True).start()
    
    # 2. Roda a automação imediatamente ao iniciar o executável
    Thread(target=executar_com_bloqueio, args=("Manual Inicial",), daemon=True).start()
    
    # 3. Escuta do teclado (PowerShell) para execuções manuais intermediárias
    Thread(target=escutar_teclado, daemon=True).start()
    
    # 4. Mantém a thread principal no loop de agendamento permanente (minutos 07, 22, 37 e 52)
    loop_agendamento()